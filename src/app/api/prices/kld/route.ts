import { NextRequest, NextResponse } from "next/server";

import { providerForChain } from "@/config/provider";
import { resolveKldPool } from "@/lib/keeper/candleIndex";
import { readCandles } from "@/lib/v2/prices/candleStore";
import {
  aggregateCandles,
  INTERVALS,
  isInterval,
  type Interval,
  type KldCandleResponse,
} from "@/lib/v2/prices/candles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/prices/kld — the KLD candle series for one chain.
 *
 * The read side of the candle stack. KLD has no CoinGecko feed (feeds.ts omits
 * it), so this is where the chart gets its price: the indexer wrote 15m candles
 * to Supabase, and this reads them back, rolls them up to the interval asked
 * for, and returns them. A server route rather than a browser read for the same
 * reason candleStore is service-role only — the anon key that reaches Supabase
 * from the client can write, and a price series anyone can write is a price
 * series nobody can trust.
 *
 * ── The pool, resolved and cached ───────────────────────────────────────────
 *
 * The store is keyed per (chain, pool), so the read has to name the same pool
 * the indexer wrote. It resolves it the identical way — the chain's factory —
 * rather than trusting a param, so the answer cannot disagree with what was
 * indexed. That is one RPC read, cached per chain with a TTL, because a pool
 * address changes about never and a price request should not pay for a factory
 * call every time.
 *
 * ── One granularity stored, any offered on read ─────────────────────────────
 *
 * Only 15m is stored. A coarser interval reads enough base candles to cover the
 * window and rolls them up (aggregateCandles), so the four intervals share one
 * source and a 1h can never disagree with its own four 15m.
 *
 * ── Absence is a state, not an error ────────────────────────────────────────
 *
 * A chain with no KLD pool (Arc) returns `pool: null` and no candles — a 200,
 * because there is nothing wrong, there is just nothing to draw, and the chart
 * says which. An empty series on a chain that HAS a pool is the honest "no
 * trades in this window yet", also a 200.
 */

/** Most base candles a coarse read will pull, so a year of 15m cannot be asked
 *  for in one request. 1d over ~13 months is the widest sensible window. */
const MAX_BASE = 40_000;
/** Default candles returned when no limit is given. */
const DEFAULT_LIMIT = 300;

interface CachedPool {
  at: number;
  pool: string | null;
}
const poolCache = new Map<number, CachedPool>();
const POOL_TTL = 10 * 60 * 1000; // 10 minutes

async function poolForChain(chainId: number): Promise<string | null> {
  const now = Date.now();
  const cached = poolCache.get(chainId);
  if (cached && now - cached.at < POOL_TTL) return cached.pool;

  const provider = providerForChain(chainId);
  if (!provider) {
    poolCache.set(chainId, { at: now, pool: null });
    return null;
  }
  try {
    const meta = await resolveKldPool(chainId, provider);
    const pool = meta?.address ?? null;
    poolCache.set(chainId, { at: now, pool });
    return pool;
  } catch {
    /* A transient resolve failure is not cached as "no pool" — that would hide
       the series for a full TTL over one bad RPC read. Cache nothing, retry
       next request. */
    return cached?.pool ?? null;
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const chainId = Number(params.get("chainId"));
  if (!Number.isInteger(chainId) || chainId <= 0) {
    return NextResponse.json({ error: "chainId is required." }, { status: 400 });
  }

  const rawInterval = params.get("interval") ?? "1h";
  if (!isInterval(rawInterval)) {
    return NextResponse.json(
      { error: `interval must be one of ${Object.keys(INTERVALS).join(", ")}.` },
      { status: 400 },
    );
  }
  const interval = rawInterval;

  const rawLimit = Number(params.get("limit"));
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 2000) : DEFAULT_LIMIT;

  const pool = await poolForChain(chainId);
  if (!pool) {
    const body: KldCandleResponse = { chainId, pool: null, interval, candles: [] };
    return NextResponse.json(body);
  }

  /* Read enough base candles to build `limit` of the coarser interval, capped so
     a wide window cannot pull the whole table. */
  const perBucket = INTERVALS[interval] / INTERVALS["15m"];
  const baseWanted = Math.min(limit * perBucket, MAX_BASE);

  const { candles: base, error } = await readCandles(chainId, pool, baseWanted);
  if (error) {
    return NextResponse.json({ error: "Could not read the price series." }, { status: 500 });
  }

  const rolled = interval === "15m" ? base : aggregateCandles(base, interval);
  /* readCandles returns ascending; keep the newest `limit`. */
  const candles = rolled.slice(-limit);

  const body: KldCandleResponse = { chainId, pool, interval, candles };
  return NextResponse.json(body);
}
