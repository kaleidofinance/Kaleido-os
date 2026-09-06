import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { CHAINS } from "@/constants/chains";
import { tradableChains } from "@/constants/registry";
import { runHealthWatch } from "@/lib/health/monitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * Five chains, one view call each plus a health read per borrower, plus a POST
 * per warning. The platform clamps this to whatever the plan allows, so it is a
 * ceiling asked for rather than one granted — a run that needs longer should be
 * narrowed with `?chainId=`, not left to be cut off half way through a chain.
 */
export const maxDuration = 60;

/**
 * GET|POST /api/health/watch — warn borrowers whose positions are near liquidation.
 *
 * The scheduler-facing half of `lib/health/monitor.ts`. All the reasoning about
 * who gets warned, the cooldown, and why the borrower set comes from a view
 * rather than from logs lives there; this file is the door.
 *
 * ── Why an HTTP endpoint ────────────────────────────────────────────────────
 *
 * Same reason as `/api/keeper/push`, and the same measurement behind it: GitHub
 * Actions delivered 47 of ~456 scheduled runs over 152 hours, one per ~3.2 h.
 * A route can be called by anything that fires on time — and here that matters
 * more than it does for the price keeper, because a stale price reverts a
 * transaction while a missed health warning is a liquidation the user was never
 * told was coming.
 *
 * ── Authentication ──────────────────────────────────────────────────────────
 *
 * This route reads chain state and writes to users' lock screens. Left open it is
 * two things: a way to make the server issue hundreds of RPC calls on request,
 * and — because the warning text is fixed here rather than supplied by the caller
 * — a way to spam a real warning at whoever happens to be near the threshold,
 * until they turn notifications off. `/api/push/send` guards the arbitrary-text
 * version of that with its own secret; this guards the trigger.
 *
 * So: `Authorization: Bearer $CRON_SECRET`, the header Vercel Cron sends of its
 * own accord, or `X-Keeper-Secret` for a scheduler that reserves Authorization
 * for its own use. Compared with `timingSafeEqual`, and never accepted from the
 * query string — a secret in a URL lands in access logs, referrers and browser
 * history. The same CRON_SECRET as the keeper route: one scheduler credential for
 * the deployment's own jobs, rather than a second secret to rotate and leak.
 *
 * With no CRON_SECRET set the route refuses everything, which is the deliberate
 * default rather than a misconfiguration — unset means "not armed".
 *
 * ── Parameters ──────────────────────────────────────────────────────────────
 *
 *   ?chainId=11155111   one chain, or repeated / comma-separated for several.
 *                       Default: every tradable chain with a Diamond recorded.
 *   ?wallet=0x…         check one address only. For confirming a real position by
 *                       hand without waiting for the cron, and for proving the
 *                       threshold against a wallet you control.
 *   ?dryRun=1           do every read, decide every warning, send nothing and
 *                       write no cooldown. What a new scheduler should be pointed
 *                       at first.
 *
 * A run is ALSO dry when APP_URL or PUSH_SEND_SECRET is missing — see
 * `runHealthWatch`. The response says which it was, so "why did nothing arrive"
 * is answerable from the body rather than by guessing at the environment.
 *
 * ── The status code is for the monitor ──────────────────────────────────────
 *
 * 200 when nothing failed, 500 when something did, mirroring `/api/keeper/push`.
 * "Every borrower is healthy" is a 200 — that run succeeded and sent nothing,
 * which is the outcome to hope for.
 */

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status });

/** Constant-time compare that does not leak length through an early return. */
function secretMatches(offered: string | null, expected: string): boolean {
  if (!offered) return false;
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  /* timingSafeEqual throws on a length mismatch, so equal-length buffers are
     compared and the lengths themselves are compared separately. A wrong length
     is already distinguishable by anyone who can time the request; a wrong byte
     must not be. */
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function authorised(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (secretMatches(bearer, secret)) return true;
  return secretMatches(request.headers.get("x-keeper-secret"), secret);
}

/** `?chainId=97&chainId=11155111` and `?chainId=97,11155111` both work. */
function parseChainIds(request: NextRequest): number[] | "invalid" {
  const raw = request.nextUrl.searchParams.getAll("chainId").join(",");
  if (!raw.trim()) return [];

  const out: number[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n <= 0) return "invalid";
    out.push(n);
  }
  return out;
}

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn(
      "[health/watch] CRON_SECRET is not set — refusing, as configured. The " +
        "monitor stays inert until it is armed.",
    );
    return json({ error: "The health monitor is not enabled." }, 503);
  }
  if (!authorised(request, secret)) {
    /* No detail: an unauthenticated caller learns nothing about which header was
       wrong, or whether a scheduler credential exists. */
    return json({ error: "Unauthorized." }, 401);
  }

  const chainIds = parseChainIds(request);
  if (chainIds === "invalid") {
    return json(
      { error: "chainId must be one or more positive integers." },
      400,
    );
  }
  const watchable = tradableChains(CHAINS).map((c) => c.id);
  const unknown = chainIds.filter((id) => !watchable.includes(id));
  if (unknown.length > 0) {
    /* Named rather than silently dropped: asking for a chain with no lending
       deployment and getting a clean 200 with an empty report is how a scheduler
       ends up watching nothing for a week. */
    return json(
      {
        error: `no lending deployment on chain(s) ${unknown.join(", ")}`,
        watchable,
      },
      400,
    );
  }

  const wallet =
    request.nextUrl.searchParams.get("wallet")?.trim() || undefined;
  if (wallet && !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return json({ error: "wallet must be a 0x-prefixed address." }, 400);
  }
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    const result = await runHealthWatch({ chainIds, dryRun, wallet });

    /* One line per run in the platform's log, because the response body goes to
       whatever called this and a cron's response body is usually discarded. */
    console.info(
      `[health/watch] ${result.warned} warned, ${result.wouldWarn} would-warn, ` +
        `${result.failed} failed across ` +
        result.chains
          .map((c) => `${c.network}:${c.status}(${c.borrowers}b/${c.checked}c)`)
          .join(" "),
    );

    return json(result, result.failed > 0 ? 500 : 200);
  } catch (error) {
    /* runHealthWatch reports per-chain failure as a status rather than throwing,
       so reaching here means something outside the per-chain work broke — the
       subscription list, most likely. */
    console.error("[health/watch] failed", error);
    return json({ error: "The health check could not be completed." }, 500);
  }
}

/** Vercel Cron issues a GET. */
export async function GET(request: NextRequest) {
  return handle(request);
}

/** Most third-party pingers and a manual curl issue a POST. */
export async function POST(request: NextRequest) {
  return handle(request);
}
