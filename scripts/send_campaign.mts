#!/usr/bin/env node
/**
 * Send the testnet access code to the registration list.
 *
 * The mechanical half of `docs/TESTNET_INVITE_CAMPAIGN.md`, which holds the
 * reasoning, the DNS setup and the warm-up schedule. This file is the part that
 * must not get the details wrong, because an email send is the one operation here
 * with no undo — a message delivered to the wrong address, or twice, stays sent.
 *
 *   npm run campaign:send -- --list ../registrations.csv                  # dry run
 *   npm run campaign:send -- --list ../registrations.csv --send --limit 200
 *
 * DRY RUN IS THE DEFAULT and `--send` is the only thing that changes it.
 *
 * ── The three properties that matter ────────────────────────────────────────
 *
 * IT IS RESUMABLE AND IT NEVER SENDS TWICE. Every success is appended to a state
 * file before the next batch begins, and a run skips any address already in it.
 * That makes a crash, a rate limit or a deliberate `--limit` batch all the same
 * thing: run it again and it continues. Sending the same person their code twice
 * is not a cosmetic error — on a list this size it is a measurable complaint rate,
 * and complaints are scored against the domain the app itself runs on.
 *
 * THE LIST NEVER ENTERS THE REPOSITORY. The path is an argument, the state file
 * defaults to sitting beside it, and `.gitignore` refuses the extensions anyway.
 * This repository is public.
 *
 * THE ACCESS CODE IS NEVER WRITTEN DOWN HERE. It is read from BETA_ACCESS_CODE at
 * runtime — the same variable the gate verifies against — so this file can be
 * public and so the email cannot disagree with the app.
 *
 * ── What it cannot do, stated so it is not assumed ──────────────────────────
 *
 * It aborts on the failure rate the provider reports AT SEND TIME, which is
 * essentially invalid or rejected recipients. It cannot see spam complaints or
 * asynchronous bounces, because those arrive hours later by webhook and there is
 * no webhook here. The complaint rate is a MANUAL gate between batches, read off
 * the provider dashboard. Do not treat a clean exit as evidence a batch landed
 * well.
 */

import fs from "node:fs";
import path from "node:path";

/* The gate's own vocabulary, not a copy of it. If the code length or the
   normalisation ever changes, this script changes with it — a local reimplementation
   would keep passing its own check while mailing a code the gate rejects. */
import { CODE_LENGTH, normaliseCode } from "../src/lib/beta";
import { cleanList, type CleanedList } from "../src/lib/campaign/recipients";
/* Derived from the message as well as the recipients, and tested. A key naming
   only the addresses made an edited resend indistinguishable from a duplicate,
   and the provider refuses that — see idempotency.ts for the failure it caused. */
import { idempotencyKey, type MessageParts } from "../src/lib/campaign/idempotency";

/* ── args ──────────────────────────────────────────────────────────────────── */

const USAGE = `Usage: npm run campaign:send -- --list <path.csv> [--send] [--limit N] [--state <path>]

  --list <path>   CSV export of the registration form. Keep it OUTSIDE this repo.
  --send          Actually send. Omitted, everything runs and nothing is sent.
  --limit N       Send at most N new addresses this run (the warm-up batch size).
  --state <path>  Progress file. Defaults to send-state.json beside the list.`;

const argv = process.argv.slice(2);
function flag(name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

const send = argv.includes("--send");
const listPath = flag("--list");
const limitRaw = flag("--limit");
const limit = limitRaw === null ? Infinity : Number(limitRaw);

if (!listPath) {
  console.error(USAGE);
  process.exit(2);
}
if (!Number.isFinite(limit) && limitRaw !== null) {
  console.error(`--limit must be a number (got "${limitRaw}")`);
  process.exit(2);
}
if (!fs.existsSync(listPath)) {
  console.error(`No such file: ${listPath}`);
  process.exit(2);
}
const statePath = flag("--state") ?? path.join(path.dirname(listPath), "send-state.json");

/* ── env ───────────────────────────────────────────────────────────────────── */

/* Walks up from cwd, because .env is gitignored and so does not exist inside a
   git worktree — a worktree is a checkout of tracked files only. */
function envFromDisk(): Record<string, string> {
  const out: Record<string, string> = {};
  let dir = process.cwd();
  for (let up = 0; up < 6; up++) {
    for (const candidate of [".env.local", ".env"]) {
      const file = path.join(dir, candidate);
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

const disk = envFromDisk();
const env = (k: string) => process.env[k] ?? disk[k] ?? "";

const ACCESS_CODE = normaliseCode(env("BETA_ACCESS_CODE"));
const API_KEY = env("RESEND_API_KEY");
const FROM = env("CAMPAIGN_FROM") || "Kaleido <official@kaleidofi.xyz>";
const REPLY_TO = env("CAMPAIGN_REPLY_TO") || "official@kaleidofi.xyz";

/* The card submits exactly CODE_LENGTH characters and /api/beta/unlock 503s if the
   configured code is any other length. Checking the same thing here means an unset
   or truncated variable fails before 3,000 people are mailed a code that cannot
   work — the one error in this script with no remedy. */
if (ACCESS_CODE.length !== CODE_LENGTH) {
  console.error(
    `BETA_ACCESS_CODE normalises to ${ACCESS_CODE.length} characters; the gate only accepts ${CODE_LENGTH}.\n` +
      "Set it in .env or the environment, and make it the value production is running.",
  );
  process.exit(2);
}
if (send && !API_KEY) {
  console.error("RESEND_API_KEY is not set, so --send cannot do anything.");
  process.exit(2);
}

/* ── the email ─────────────────────────────────────────────────────────────── */

const SUBJECT = "Your Kaleido testnet access code";

/* The app's own host, and the direct path rather than the bare subdomain:
   app.kaleidofi.xyz answers 307 -> /trade -> 307 -> /trade/agent, and each hop is a
   chance for a link scanner to rewrite or flag it. In an email whose whole premise is
   "this came from us", a redirect chain is the wrong thing to ship. Verified 200. */
const APP_URL = "https://app.kaleidofi.xyz/trade/agent";
/* Docs stay on the marketing host, where they are canonical and ungated. */
const GUIDE_URL = "https://kaleidofi.xyz/docs/getting-started";

/* Both parts are sent. Plain text is not a fallback nobody reads — a message with
   no text/plain part scores worse with spam filters than one with it, and this
   email is four sentences, so writing it twice costs nothing. */
const TEXT = `You registered for the Kaleido private testnet. Here is your access code.

    ${ACCESS_CODE}

Open ${APP_URL} and enter it once. It is remembered on that browser afterwards.

Start on Base Sepolia — it is the fastest of the five networks to get funded on.
The first ten minutes, step by step: ${GUIDE_URL}

The part worth trying first is Luca. Connect your wallet, then tell it what you
want in plain language — "swap 50 USDC for ETH", "lend 100 USDC at 8%" — and it
builds the transactions for you to sign. It needs a connected wallet before it
will do anything, so connect first.

— The Kaleido team
${REPLY_TO}

We will never ask for your seed phrase or private key.
`;

const HTML = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#0b0b0f;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#e8e8ef">
<div style="max-width:520px;margin:0 auto">
<p style="margin:0 0 20px">You registered for the Kaleido private testnet. Here is your access code.</p>
<p style="margin:0 0 24px;padding:16px;background:#16161d;border:1px solid #2a2a35;border-radius:10px;font:600 26px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;text-align:center;color:#fff">${ACCESS_CODE}</p>
<p style="margin:0 0 20px"><a href="${APP_URL}" style="color:#8b8bff">Open the app</a> and enter it once. It is remembered on that browser afterwards.</p>
<p style="margin:0 0 20px">Start on <strong>Base Sepolia</strong> — it is the fastest of the five networks to get funded on. <a href="${GUIDE_URL}" style="color:#8b8bff">The first ten minutes, step by step.</a></p>
<p style="margin:0 0 20px">The part worth trying first is <strong>Luca</strong>. Connect your wallet, then tell it what you want in plain language — &ldquo;swap 50 USDC for ETH&rdquo;, &ldquo;lend 100 USDC at 8%&rdquo; — and it builds the transactions for you to sign. It needs a connected wallet before it will do anything, so connect first.</p>
<p style="margin:0 0 8px">&mdash; The Kaleido team<br><a href="mailto:${REPLY_TO}" style="color:#8b8bff">${REPLY_TO}</a></p>
<p style="margin:24px 0 0;font-size:13px;color:#8a8a99">We will never ask for your seed phrase or private key.</p>
</div></body></html>`;

/* mailto rather than an HTTPS one-click endpoint, because no unsubscribe route
   exists to point at and a List-Unsubscribe-Post header without a working URL is
   worse than no header — providers surface a button that then fails. */
const HEADERS = {
  "List-Unsubscribe": `<mailto:${REPLY_TO}?subject=unsubscribe>`,
};

/* One description of the message, used both to build each request and to identify
   it. Keeping it in one place is the point: if the copy above is edited and this
   is not, the key stops tracking the message and the provider starts refusing
   resends again. */
const MESSAGE: MessageParts = {
  from: FROM,
  replyTo: REPLY_TO,
  subject: SUBJECT,
  text: TEXT,
  html: HTML,
};

/* ── the list ────────────────────────────────────────────────── */

/* Every rule about who is and is not on this list lives in src/lib/campaign, with a
   test, because a rule that drops the wrong people fails quietly here: the run just
   reports a smaller number. See recipients.test.ts for the cases, including the 32
   real registrations that an earlier version of this script discarded. */
let list: CleanedList;
try {
  list = cleanList(fs.readFileSync(listPath, "utf8"));
} catch (err) {
  console.error(`${listPath}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const { recipients, stats } = list;

if (list.emailColumnGuessed) {
  /* No header mentioned email, so the column was inferred from its contents. Worth
     saying out loud: a wrong guess is the one failure that still produces a
     plausible-looking list, just of the wrong people. */
  console.log(
    `No "email" header — inferred column ${list.emailColumn} ("${list.header[list.emailColumn] ?? ""}") from its contents.`,
  );
}

/* ── state ─────────────────────────────────────────────────────────────────── */

type State = { sent: Record<string, string>; failed: Record<string, string> };

function loadState(): State {
  if (!fs.existsSync(statePath)) return { sent: {}, failed: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as Partial<State>;
    return { sent: parsed.sent ?? {}, failed: parsed.failed ?? {} };
  } catch (err) {
    /* Refuse rather than start clean. An unreadable state file with a fresh start
       behind it means sending the whole list a second time. */
    console.error(
      `${statePath} exists but could not be parsed: ${err instanceof Error ? err.message : err}\n` +
        "Fix or move it. Continuing would re-send to everyone already mailed.",
    );
    process.exit(2);
  }
}

const state = loadState();
/* A previous failure is retried; a previous success never is. */
const pending = recipients.filter((a) => !(a in state.sent));
const batch = pending.slice(0, limit === Infinity ? pending.length : limit);

console.log(
  `\n${send ? "SENDING" : "DRY RUN"} — ${SUBJECT}\n` +
    `from ${FROM}   reply-to ${REPLY_TO}   code ${ACCESS_CODE.length} chars\n\n` +
    `list        ${listPath}\n` +
    `state       ${statePath}\n` +
    `rows        ${stats.rows}\n` +
    `  recovered ${stats.recovered}${stats.recovered > 0 ? " (address was in another column)" : ""}\n` +
    `  unusable  ${stats.unusable}${stats.ambiguous > 0 ? ` (${stats.ambiguous} offered two addresses)` : ""}\n` +
    `  role      ${stats.role}\n` +
    `  duplicate ${stats.duplicate}\n` +
    `deliverable ${recipients.length}\n` +
    `already     ${Object.keys(state.sent).length}\n` +
    `this run    ${batch.length}${limit !== Infinity && pending.length > batch.length ? ` (of ${pending.length} remaining)` : ""}\n`,
);

if (batch.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

if (!send) {
  console.log(`First few: ${batch.slice(0, 3).join(", ")}`);
  console.log(`\n--- text/plain ---\n${TEXT}`);
  console.log("Add --send to send. Check the copy above first.");
  process.exit(0);
}

/* ── send ──────────────────────────────────────────────────────────────────── */

/* Resend's batch endpoint takes up to 100 discrete messages per call — discrete
   being the point. One message addressed to 3,000 people would expose the whole
   list to every recipient. */
const CHUNK = 100;
/* The documented default is 2 requests/second. */
const PAUSE_MS = 600;
/* Above this share of send-time rejections, stop. The list is dirtier than the
   filters above caught, and continuing spends domain reputation to find that out
   at a larger scale. Evaluated only once there is enough to divide by. */
const FAILURE_ABORT = 0.05;
const MIN_BEFORE_ABORT = 20;

function persist() {
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

let ok = 0;
let failed = 0;
let aborted = false;

for (let i = 0; i < batch.length && !aborted; i += CHUNK) {
  const chunk = batch.slice(i, i + CHUNK);
  const payload = chunk.map((to) => ({
    from: MESSAGE.from,
    to: [to],
    reply_to: MESSAGE.replyTo,
    subject: MESSAGE.subject,
    text: MESSAGE.text,
    html: MESSAGE.html,
    headers: HEADERS,
  }));

  let results: Array<{ id?: string; error?: { message?: string } }> | null = null;
  let transportError: string | null = null;

  try {
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
        /* Makes a retried chunk safe at the provider rather than only here, and
           covers the message as well as the addresses so that a resend after a
           copy edit is a new request instead of a rejected duplicate. */
        "idempotency-key": idempotencyKey(MESSAGE, chunk),
      },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as {
      data?: Array<{ id?: string; error?: { message?: string } }>;
      message?: string;
    };
    if (!res.ok) transportError = body.message ?? `HTTP ${res.status}`;
    else results = body.data ?? [];
  } catch (err) {
    transportError = err instanceof Error ? err.message : String(err);
  }

  if (transportError) {
    /* A whole-chunk failure is not recorded per address. Nothing is known about
       delivery, and writing these down as failures would let a later run treat a
       network blip as a decision. */
    console.log(`  chunk ${i / CHUNK + 1}: could not be submitted — ${transportError}`);
    if (/idempotenc/i.test(transportError)) {
      /* Should be unreachable now that the key covers the message body. Kept
         because if it does fire, re-running will fail identically until the cause
         is fixed — which makes it the one submission error that is NOT a blip. */
      console.log(
        "    ↑ the provider refusing a reused key, not a network fault. The key no longer\n" +
          "      tracks the message it identifies: see src/lib/campaign/idempotency.ts.",
      );
    }
    failed += chunk.length;
  } else {
    chunk.forEach((address, n) => {
      const r = results?.[n];
      if (r?.id) {
        state.sent[address] = r.id;
        delete state.failed[address];
        ok++;
      } else {
        state.failed[address] = r?.error?.message ?? "no id returned";
        failed++;
      }
    });
    /* Before the next chunk, always. A crash after this line costs nothing; a
       crash before it would re-send this chunk. */
    persist();
    console.log(`  ${ok} sent, ${failed} failed`);
  }

  const attempted = ok + failed;
  if (attempted >= MIN_BEFORE_ABORT && failed / attempted > FAILURE_ABORT) {
    aborted = true;
    console.log(
      `\nABORTED — ${((failed / attempted) * 100).toFixed(1)}% of ${attempted} were rejected, ` +
        `over the ${FAILURE_ABORT * 100}% ceiling.`,
    );
  }

  if (i + CHUNK < batch.length && !aborted) {
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
}

persist();

const remaining = recipients.length - Object.keys(state.sent).length;
console.log(
  `\n${ok} sent, ${failed} failed, ${remaining} still to go.\n` +
    `State written to ${statePath} — re-run to continue, no address is sent twice.\n\n` +
    "NOW CHECK THE PROVIDER DASHBOARD before the next batch. Spam complaints and\n" +
    "asynchronous bounces arrive later and are not visible here: stop at 5% bounces\n" +
    "or 0.1% complaints.",
);
process.exit(aborted || failed > 0 ? 1 : 0);
