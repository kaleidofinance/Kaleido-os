import { NextResponse } from "next/server";
import { discoveryChains } from "@/lib/dex/poolDiscovery";
import { sweepChain } from "@/lib/dex/poolSweep";
import { priceLookup, type SpotPrices } from "@/lib/market/spot";
import { PRICEABLE, getPrices } from "@/lib/points/prices";
import type { ITradingPair } from "@/constants/types/dex";

/**
 * GET /api/pools — the V3 pool list, swept once on the server.
 *
 * The pool table used to run the whole sweep in every browser: hundreds of
 * `getPool` calls per tab at Arc's rate-limited RPC, ~15s and prone to stalling.
 * This runs it here instead — once per TTL, shared across every tab through one
 * cached response — so a browser fetches a ready list rather than fanning out.
 *
 * Mainnet chains only: the mainnet-first default is what this serves, and a
 * testnet viewer keeps the client-side sweep (useV3Pools falls back to it). One
 * throttled or dead chain doesn't sink the rest — each is bounded and settled
 * independently, the same contract the client sweep has.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TTL_MS = 30_000;
/* Per-chain ceiling, so a hung endpoint can't hold the whole response. Wider
   than the client's own per-chain deadline because the server pays it once for
   everyone, not per tab. */
const CHAIN_TIMEOUT_MS = 18_000;

let cache: { at: number; pools: ITradingPair[] } | null = null;
let inflight: Promise<ITradingPair[]> | null = null;

async function priceMap() {
  const results = await getPrices(PRICEABLE);
  const usd: Record<string, number> = {};
  results.forEach((r, symbol) => {
    if (r.usd !== null && Number.isFinite(r.usd) && (r.usd as number) > 0) {
      usd[symbol] = r.usd as number;
    }
  });
  return priceLookup({ usd, asOf: new Date().toISOString() } as SpotPrices);
}

function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function compute(): Promise<ITradingPair[]> {
  const priceOf = await priceMap();
  const chains = discoveryChains().filter((c) => c.meta.network === "mainnet");
  const settled = await Promise.allSettled(
    chains.map((c) =>
      withTimeout(sweepChain(c, priceOf), CHAIN_TIMEOUT_MS, [] as ITradingPair[]),
    ),
  );
  const pools: ITradingPair[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") pools.push(...r.value);
  }
  return pools;
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return NextResponse.json({ pools: cache.pools, stale: false });
  }
  try {
    if (!inflight) {
      inflight = compute().finally(() => {
        inflight = null;
      });
    }
    const pools = await inflight;
    cache = { at: Date.now(), pools };
    return NextResponse.json({ pools, stale: false });
  } catch {
    /* Serve the last good list rather than nothing, flagged stale — the client
       falls back to its own sweep only when there is no cache at all. */
    if (cache) return NextResponse.json({ pools: cache.pools, stale: true });
    return NextResponse.json({ pools: [], error: "sweep unavailable" });
  }
}
