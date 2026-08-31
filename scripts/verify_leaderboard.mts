#!/usr/bin/env node
/**
 * Runs the two leaderboard route handlers against the live database.
 *
 * The sibling of verify:schema, and deliberately a level above it. That one asks
 * whether the columns exist; this one imports the real GET functions and calls
 * them, so it covers resolveSeason, computeBoard, the row mapping, the response
 * envelope and the status codes — the code between the schema and the page, which
 * has no other test.
 *
 * Two things it proves that a query replay cannot:
 *
 *   1. The routes hold the ANON client on purpose (route.ts:22-25), because
 *      `point_balances` is service-role-only while `point_leaderboard` is granted
 *      to anon. A service-role probe passes whether or not that grant survived
 *      20260817's drop-and-recreate of the view. This one does not.
 *   2. A named season that is absent answers 404 and writes no `[leaderboard]
 *      failed:` line. That log is how a broken read announces itself, and a
 *      schema genuinely missing seven columns hid behind an error of that shape
 *      for the whole life of this route.
 *
 *   npm run verify:leaderboard
 *
 * Reads only, so it is safe against production and costs nothing. Not in the
 * `npm test` chain — that chain is offline and hermetic, and this needs .env and
 * the network.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NextRequest } from "next/server";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/* No Next runtime is loading .env for a script, and the route modules read
   process.env at import time — so this has to happen before the imports below,
   which is why they are dynamic. Same minimal parser as the .cjs verifiers. */
for (const raw of fs
  .readFileSync(path.join(ROOT, ".env"), "utf8")
  .split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 1) continue;
  const k = line.slice(0, eq).trim();
  if (!process.env[k])
    process.env[k] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
}

let failed = 0;
/* Held so finish() can stop its auth ticker on every exit path, including the
   early ones. See the note where it is assigned. */
let client: { auth: { stopAutoRefresh: () => void } } | null = null;
const pass = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => {
  failed++;
  console.log(`  ✗ ${m}`);
};

/** Both routes answer `{ success, data, stale }`; `error` stays on the envelope. */
async function call(fn: (r: NextRequest) => Promise<Response>, url: string) {
  const res = await fn(new NextRequest(new URL(url)));
  const env = await res.json();
  return {
    status: res.status,
    body: { ...(env.data ?? {}), error: env.error as string | undefined },
  };
}

async function main() {
  console.log("\nLeaderboard routes, run for real\n");

  console.log("the client the routes actually hold");
  const anon = process.env.NEXT_PUBLIC_SUPABASE_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL)
    return (fail("NEXT_PUBLIC_SUPABASE_URL is empty"), finish());
  pass(`project ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  if (!anon)
    return (
      fail(
        "NEXT_PUBLIC_SUPABASE_KEY is empty — supabaseClient falls back to a placeholder",
      ),
      finish()
    );
  /* If these matched, every pass below would be a service-role pass wearing the
     anon client's name, and the grant this script exists to check would be
     untested. */
  anon !== service
    ? pass(
        "it is not the service-role key — these reads go through the anon grant",
      )
    : fail(
        "the anon key IS the service key — the grant below is not being tested",
      );
  if (
    process.env.NEXT_PUBLIC_MOCK_DATA === "1" ||
    process.env.NEXT_PUBLIC_MOCK_DATA === "true"
  )
    fail(
      "NEXT_PUBLIC_MOCK_DATA is on — the PAGE will render fixtures no matter what this script finds",
    );

  const { GET: board } = await import("../src/app/api/leaderboard/route.ts");
  const { GET: me } = await import("../src/app/api/leaderboard/me/route.ts");
  /*
   * The same client instance the two routes just imported. Held only so it can be
   * shut down: supabaseClient.ts calls `createClient` with no options, so GoTrue's
   * `autoRefreshToken` defaults on and starts a 30s ticker. In the server runtime
   * that module lives as long as the process and the ticker costs nothing; in a
   * script it is a ref'd timer that held the event loop open ~55s past the last
   * check. Stopping it is the alternative to exiting past it, which is what the
   * note in finish() is about.
   */
  client = (await import("../src/lib/supabase/supabaseClient.ts")).supabase;

  console.log("\nGET /api/leaderboard (default season)");
  const { status, body } = await call(
    board,
    "http://localhost/api/leaderboard",
  );
  if (status !== 200) return (fail(`HTTP ${status}: ${body.error}`), finish());
  pass("HTTP 200");
  /* Named explicitly. This is the string the column drift produced, and it reads
     like a transient outage, which is why it went unnoticed. */
  body.error === "Could not read the season registry"
    ? fail("the schema-drift error is back — run `npm run verify:schema`")
    : body.error
      ? fail(`carries an error: ${body.error}`)
      : pass("no error — the season registry was readable");
  Number.isInteger(body.season?.id)
    ? pass(`resolved a default season (id ${body.season.id})`)
    : fail(`season = ${JSON.stringify(body.season)}`);
  body.season?.disclosure
    ? pass(`disclosure tier reached the payload (${body.season.disclosure})`)
    : fail("the payload carries no disclosure tier");
  Array.isArray(body.rows)
    ? pass(`rows is an array (${body.rows.length})`)
    : fail("rows is not an array");
  /* An empty board is correct while nothing has written to `point_balances`. What
     must not happen is `degraded` naming a leg, because a failed rows read hides
     behind the same empty array as an honest one. */
  Array.isArray(body.degraded) && body.degraded.length === 0
    ? pass("no degraded legs")
    : fail(`degraded = ${JSON.stringify(body.degraded)} — a read failed`);
  typeof body.participants === "number"
    ? pass(`participants counted (${body.participants})`)
    : fail(`participants = ${JSON.stringify(body.participants)}`);
  Array.isArray(body.seasons) && body.seasons.length > 0
    ? pass(`selector has ${body.seasons.length} season(s)`)
    : fail(`seasons = ${JSON.stringify(body.seasons)}`);

  /* Every other season, each on its own tier. The tier decides which columns the
     page renders, so one that fails to resolve is a page that cannot say what it
     is withholding. */
  console.log("\nevery season resolves");
  for (const ref of (body.seasons ?? []) as { id: number; label: string }[]) {
    const r = await call(
      board,
      `http://localhost/api/leaderboard?season=${ref.id}`,
    );
    r.status === 200 && r.body.season?.id === ref.id
      ? pass(`season ${ref.id} (${r.body.season.disclosure})`)
      : fail(`season ${ref.id} → HTTP ${r.status} ${r.body.error ?? ""}`);
  }

  console.log("\na season that does not exist is the caller's mistake");
  const absent = await call(
    board,
    "http://localhost/api/leaderboard?season=99",
  );
  absent.status === 404
    ? pass("404, and no [leaderboard] failed: line above")
    : fail(
        `HTTP ${absent.status} — a client mistake logged and reported as a server fault`,
      );
  absent.body.error
    ? pass(`says which: "${absent.body.error}"`)
    : fail("404 with no reason");
  /* The cache and the inflight map are keyed by (season, limit), so a rejection
     must not strand a key a later request shares. */
  (await call(board, "http://localhost/api/leaderboard")).status === 200
    ? pass("the default board still answers afterwards")
    : fail("the 404 poisoned the cache");

  console.log("\nGET /api/leaderboard/me");
  const seasonId = body.season.id;
  const WALLET = "0x000000000000000000000000000000000000dead";
  const mine = await call(
    me,
    `http://localhost/api/leaderboard/me?wallet=${WALLET}&season=${seasonId}`,
  );
  mine.status === 200
    ? pass(`HTTP 200 for season ${seasonId}`)
    : fail(`HTTP ${mine.status}: ${mine.error ?? mine.body.error}`);
  mine.body.error
    ? fail(`carries an error: ${mine.body.error}`)
    : pass("no error — the view was readable as anon");
  /* A wallet with no points is `row: null`, which is a different answer from a
     read that failed, and the page renders them differently ("Unranked" versus
     "could not be read"). The field has to be there for that to work. */
  "row" in mine.body
    ? pass(`answers with a row field (${JSON.stringify(mine.body.row)})`)
    : fail(`no row field: ${JSON.stringify(mine.body)}`);
  typeof mine.body.participants === "number"
    ? pass(`participants counted (${mine.body.participants})`)
    : fail(`participants = ${JSON.stringify(mine.body.participants)}`);

  const malformed = await call(
    me,
    `http://localhost/api/leaderboard/me?wallet=nope&season=${seasonId}`,
  );
  malformed.status === 400
    ? pass("a malformed wallet is a 400")
    : fail(`malformed wallet → HTTP ${malformed.status}`);
  /* Required rather than defaulted, so a standing card cannot end up describing a
     different season than the table beside it. */
  (await call(me, `http://localhost/api/leaderboard/me?wallet=${WALLET}`))
    .status === 400
    ? pass("a missing season is a 400, not a guess")
    : fail("a missing season was defaulted");

  finish();
}

function finish() {
  console.log(
    failed === 0
      ? "\nThe leaderboard routes work.\n"
      : `\n${failed} check(s) failed — /leaderboard is not serving correctly.\n`,
  );
  /*
   * `process.exitCode` rather than `process.exit()`, and the difference is not
   * stylistic. Exiting while a keep-alive socket from these fetches is mid-close
   * aborts Node on Windows — "Assertion failed: !(handle->flags &
   * UV_HANDLE_CLOSING), file src\\win\\async.c" — which reports 127 instead of 1.
   * A gate that cannot reliably say "failed" is not a gate, so the loop is left
   * to drain; undici holds its connections for a few seconds after the last
   * request, which is the whole cost.
   */
  process.exitCode = failed === 0 ? 0 : 1;
  client?.auth.stopAutoRefresh();
}

main().catch((e) => {
  console.error("\nverifier crashed:", e);
  process.exitCode = 1;
});
