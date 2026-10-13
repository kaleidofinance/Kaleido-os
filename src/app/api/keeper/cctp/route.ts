import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { completeCctpTransfers } from "@/lib/keeper/cctpKeeper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* One attestation fetch, one estimate and one send per row, with one bounded
   confirmation wait; five rows a run is the default for that reason. A run
   that needs longer should be narrowed with ?limit=, not cut off mid-send. */
export const maxDuration = 60;

/**
 * GET|POST /api/keeper/cctp — complete attested CCTP transfers on their
 * destination chain, paying the gas the user may not have there.
 *
 * The scheduler-facing half of `lib/keeper/cctpKeeper.ts`, which holds the
 * reasoning: what a burn is, why anyone may complete it, and why the app
 * should be the one to. This file is the door, and it is the same door as
 * `/api/keeper/push`: `Authorization: Bearer $CRON_SECRET` (or `X-Keeper-Secret`),
 * compared with `timingSafeEqual`, never accepted from the query string. With
 * no CRON_SECRET set the route refuses everything — this route spends the
 * keeper's gas, and a spending endpoint that runs while unarmed is the one
 * failure there is no recovering from.
 *
 * Parameters:
 *   ?dryRun=1     resolve attestations and report what WOULD mint; send nothing.
 *   ?limit=N      rows per run (1–25, default 5), oldest first.
 *
 * The clock is scripts/keeper-cron/keeper-cron-worker.js on its own two-minute
 * trigger: Fast Transfer attests in seconds and Standard in minutes, so a
 * fifteen-minute tick would leave every user staring at a "waiting" bar for
 * most of that.
 */

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status });

function secretMatches(offered: string | null, expected: string): boolean {
  if (!offered) return false;
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
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

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn(
      "[keeper/cctp] CRON_SECRET is not set — refusing, as configured. The " +
        "keeper route stays inert until it is armed.",
    );
    return json({ error: "The keeper route is not enabled." }, 503);
  }
  if (!authorised(request, secret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const params = request.nextUrl.searchParams;
  const dryRun = ["1", "true"].includes((params.get("dryRun") ?? "").toLowerCase());
  const limitRaw = Number(params.get("limit") ?? "5");
  const limit = Number.isInteger(limitRaw) ? limitRaw : 5;

  const startedAt = Date.now();
  const result = await completeCctpTransfers({ dryRun, limit });
  const ms = Date.now() - startedAt;
  const line =
    `[keeper/cctp] ${dryRun ? "dry-run " : ""}processed=${result.processed} ` +
    `minted=${result.minted.length} wouldMint=${result.wouldMint.length} ` +
    `pending=${result.stillPending} failed=${result.failed.length} ` +
    `skipped=${result.skipped.length} errors=${result.errors.length} ${ms}ms` +
    (result.error ? ` error=${result.error}` : "");
  (result.ok ? console.info : console.error)(line);
  for (const s of result.skipped) console.warn(`[keeper/cctp] skipped ${s}`);
  for (const e of result.errors) console.warn(`[keeper/cctp] error ${e}`);

  return json({ ...result, ms }, result.ok ? 200 : 503);
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
