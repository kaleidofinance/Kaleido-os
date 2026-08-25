import { NextResponse } from "next/server";
import { PRICEABLE, getPrices } from "@/lib/points/prices";
import type { SpotPrices } from "@/lib/market/spot";

/**
 * Spot USD prices for the browser.
 *
 * The browser cannot call `lib/points/prices.ts` directly — that module throws
 * on import client-side, because a price the client supplies is a point balance
 * the client supplies. This route is the only way through, and it is a proxy in
 * the same sense `api/prices/route.ts` is one:
 *
 *   - One cached response serves every tab. Hermes rate-limits per IP, and a
 *     pool table that priced each leg from the browser would spend a user's
 *     whole budget on one page load.
 *   - The response shape is ours, not Hermes'. Symbol → USD, nothing else.
 *
 * There are no parameters, deliberately. The caller does not choose which
 * symbols to ask for: the route serves the whole priceable table (eight symbols
 * today), which is smaller than most symbol lists a caller would send and means
 * no caller input reaches an outbound request at all. It also makes the cache a
 * single slot rather than one entry per distinct symbol set.
 *
 * Nothing here is secret — these are public market prices — so there is no
 * authentication. The reason it is server-side is consistency and rate limits,
 * not confidentiality.
 */

export const dynamic = "force-dynamic";

const TTL_MS = 60_000;

/* Single-slot cache: the route takes no parameters, so there is nothing to key
 * on and no need for the bounded map `api/prices/route.ts` uses. `inflight`
 * collapses concurrent misses — without it, every tab that loads at once misses
 * together and every one of them calls Hermes. */
let cache: { at: number; body: SpotPrices } | null = null;
let inflight: Promise<SpotPrices> | null = null;

async function compute(): Promise<SpotPrices> {
  const results = await getPrices(PRICEABLE);
  const usd: Record<string, number> = {};

  /* Only usable prices are published. `getPrices` reports an asset with no feed
   * as `usd: null`, and the wire contract is that an absent symbol has no
   * price — so a null is simply left out rather than sent as a zero that a
   * caller might multiply by. */
  results.forEach((result, symbol) => {
    if (
      result.usd !== null &&
      Number.isFinite(result.usd) &&
      (result.usd as number) > 0
    ) {
      usd[symbol] = result.usd as number;
    }
  });

  return { usd, asOf: new Date().toISOString() };
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  const now = Date.now();

  if (cache && now - cache.at < TTL_MS) {
    return NextResponse.json(
      { success: true, data: cache.body, stale: false },
      { headers: NO_STORE },
    );
  }

  try {
    if (!inflight) {
      inflight = compute().finally(() => {
        inflight = null;
      });
    }
    const body = await inflight;
    cache = { at: Date.now(), body };
    return NextResponse.json(
      { success: true, data: body, stale: false },
      { headers: NO_STORE },
    );
  } catch (err) {
    /* `getPrices` only throws when the price source itself is unreachable — a
     * single asset with no feed is a normal `usd: null`. Serve the last good
     * prices rather than nothing, flagged stale, on the same reasoning as the
     * chart proxy: a minute-old ETH price is worth more to a table of pool TVLs
     * than an empty column. */
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[prices/spot] recompute failed:", message);

    if (cache) {
      return NextResponse.json(
        { success: true, data: cache.body, stale: true },
        { headers: NO_STORE },
      );
    }

    /* Nothing cached and the feed is down. 502 rather than an empty map: an
     * empty `usd` is indistinguishable on the wire from "none of these assets
     * has a price", and a caller told that would render every figure as unknown
     * without ever learning the feed had failed. */
    return NextResponse.json(
      { success: false, error: "price feed unavailable", details: message },
      { status: 502, headers: NO_STORE },
    );
  }
}
