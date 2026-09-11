import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { indexChains } from "@/lib/keeper/candleIndex";
import { CHAINS } from "@/constants/chains";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A run is a getLogs sweep per chain plus block-timestamp reads plus an upsert.
 * Asked for, not granted — the platform clamps it. A chain whose window is too
 * wide to finish should be narrowed with ?chainId=, not left to be cut off.
 */
export const maxDuration = 60;

/**
 * GET|POST /api/keeper/candles — fold new KLD pool swaps into stored candles.
 *
 * The scheduler-facing door for lib/keeper/candleIndex.ts, and a deliberate
 * copy of /api/keeper/push's auth rather than a shared helper: the two routes
 * are the only things holding CRON_SECRET, and a copy that drifts is safer to
 * spot than an abstraction that hides which door it guards. All the reasoning
 * about pools, spans and reorgs lives in the lib; this file is the door.
 *
 * ── Why an HTTP endpoint, and why the same cron ─────────────────────────────
 *
 * The price pusher already runs behind a Cloudflare Worker every 15 minutes
 * because GitHub Actions drops scheduled runs under load. The candle indexer
 * wants exactly that cadence — a 15m bucket per run — so it rides the same
 * scheduler rather than inventing a second one. The two are independent work
 * against the same wallet-free read path, so a run of one never blocks the other.
 *
 * ── Authentication, which is not optional ───────────────────────────────────
 *
 * This route does not spend gas — it only reads and writes Supabase — but it is
 * armed the same way, because a writable candle store is a way to fill the price
 * series with junk (see the migration). `Authorization: Bearer $CRON_SECRET`,
 * the header Vercel Cron sends when CRON_SECRET is set, or `X-Keeper-Secret` for
 * a scheduler that reserves Authorization; compared with timingSafeEqual and
 * never read from the query string, where it would land in access logs. With no
 * CRON_SECRET set the route refuses everything — unset means unarmed.
 *
 * ── Parameters ──────────────────────────────────────────────────────────────
 *
 *   ?chainId=84532      one chain, or comma-separated / repeated for several.
 *                       Default: every chain in the registry. A chain with no
 *                       KLD pool (Arc) resolves to nothing and is a clean skip.
 *   ?dryRun=1           scan and count, write nothing. Point a new scheduler here
 *                       first, and read the swaps/candles it reports back.
 *
 * 200 when nothing failed, 500 when a chain reported an error, so a cron monitor
 * can watch the status while a human reads the per-chain body.
 */

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** Constant-time compare that does not leak length through an early return. */
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

/** `?chainId=84532&chainId=97` and `?chainId=84532,97` both work. */
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
      "[keeper/candles] CRON_SECRET is not set — refusing, as configured.",
    );
    return json({ error: "The keeper route is not enabled." }, 503);
  }
  if (!authorised(request, secret)) {
    return json({ error: "Unauthorized." }, 401);
  }

  const parsed = parseChainIds(request);
  if (parsed === "invalid") {
    return json({ error: "chainId must be one or more positive integers." }, 400);
  }
  /* Default to every registry chain. Ones without a KLD pool resolve to a clean
     skip in the lib, so an empty chainId is not the same failure mode as the
     pusher's — there is no gas to waste on a chain that has nothing to index. */
  const chainIds = parsed.length > 0 ? parsed : CHAINS.map((c) => c.id);
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    const results = await indexChains(chainIds, { dryRun });
    const failed = results.filter((r) => r.error).length;
    const wrote = results.reduce((n, r) => n + (r.wrote ? r.candles : 0), 0);

    console.info(
      `[keeper/candles] ${wrote} candles across ` +
        results
          .map((r) => `${r.chainId}:${r.pool ? `${r.swaps}sw/${r.candles}c` : "no-pool"}${r.error ? "!" : ""}`)
          .join(" "),
    );

    return json({ dryRun, results }, failed > 0 ? 500 : 200);
  } catch (error) {
    console.error("[keeper/candles] failed", error);
    return json({ error: "The candle run could not be completed." }, 500);
  }
}

/** Vercel Cron / the Cloudflare Worker issues a GET. */
export async function GET(request: NextRequest) {
  return handle(request);
}

/** A manual curl or third-party pinger issues a POST. */
export async function POST(request: NextRequest) {
  return handle(request);
}
