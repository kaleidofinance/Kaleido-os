import type { PoolTxn } from "@/hooks/dex/usePoolTransactions";

/**
 * A pool's price history for the price card: one point per swap the page has
 * read (token1 per token0, the swap's own executed ratio), oldest first, ending
 * at the pool's live price "now". Nothing is interpolated or invented — a pool
 * with no swaps in the scanned window returns just the live point, and the card
 * then shows the price without a line.
 *
 * The executed ratio includes the pool fee and price impact, so a single swap
 * point sits a little off the mid price; that is the price that traded.
 */
export interface PricePoint {
  at: number;
  price: number;
}

export function priceSeries(
  txns: PoolTxn[],
  livePrice: number | null,
  now = Date.now(),
): PricePoint[] {
  const pts = txns
    .filter(
      (t) =>
        t.kind === "swap" &&
        t.at !== null &&
        t.amount0 > 0 &&
        t.amount1 > 0 &&
        Number.isFinite(t.amount1 / t.amount0),
    )
    .map((t) => ({ at: t.at as number, price: t.amount1 / t.amount0 }))
    .sort((a, b) => a.at - b.at);
  if (livePrice !== null && Number.isFinite(livePrice) && livePrice > 0)
    pts.push({ at: Math.max(now, pts[pts.length - 1]?.at ?? now), price: livePrice });
  return pts;
}

/** Change from the first point to the last, as a fraction; null under 2 points. */
export function seriesChange(pts: PricePoint[]): number | null {
  if (pts.length < 2 || pts[0].price <= 0) return null;
  return pts[pts.length - 1].price / pts[0].price - 1;
}
