/**
 * Spot USD prices, as the browser is allowed to see them.
 *
 * `lib/points/prices.ts` is the price authority and it throws on import in the
 * browser — deliberately, because a client-supplied price is a client-supplied
 * point balance. This module is the isomorphic half: the wire shape of
 * `/api/prices/spot`, the fetch for it, and the symbol lookup. It imports
 * nothing server-side and carries no secret, so both sides can load it.
 *
 * Why route the browser through the same table at all, rather than letting each
 * client feature find its own feed: /leaderboard shows a lending TVL priced by
 * that table and /pool shows a pool TVL one nav click away. Two sources for the
 * price of ETH puts two different dollar figures on one screen — or, worse, on
 * two screens a user compares from memory — and the reader has no way to tell
 * which of them is wrong. This is the same reason points/prices' own header
 * gives for being shared rather than points-specific.
 */

/** Wire shape of `GET /api/prices/spot`. */
export interface SpotPrices {
  /**
   * Symbol → USD price, keyed exactly as the price table spells it (`kfUSD`,
   * `WETH`).
   *
   * A symbol ABSENT from this map has no USD price. That is a normal condition
   * — KLD has no market before TGE — and not an error, so a caller must render
   * it as unknown rather than as zero. Only prices that are finite and above
   * zero appear here at all.
   */
  usd: Record<string, number>;
  /** When the prices were computed, so a stale serve is visible. */
  asOf: string;
}

export type PriceLookup = (symbol: string) => number | null;

/**
 * Build a symbol → price lookup over a fetched map.
 *
 * Exact match first, then case-insensitive. The table's keys are exact-case
 * because that is how the protocol spells its own tokens, but a pool leg's
 * symbol comes off an arbitrary ERC20's `symbol()` and nothing forces that to
 * agree on case. Falling back is safe for a symbol in a way it would never be
 * for an address: `usdc` and `USDC` are the same dollar, whereas two addresses
 * differing only in case are one checksum apart from being different tokens.
 *
 * Returns null for anything unpriced, never a default. A price of zero counts
 * as no price: no listed asset is worth exactly nothing, so a zero is a broken
 * feed, and multiplying reserves by it would report a funded pool as empty.
 */
export function priceLookup(prices: SpotPrices | null): PriceLookup {
  if (!prices || !prices.usd) return () => null;

  const usable = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v > 0;

  const lower = new Map<string, number>();
  for (const key of Object.keys(prices.usd)) {
    const value = prices.usd[key];
    if (usable(value)) lower.set(key.toLowerCase(), value);
  }

  return (symbol: string) => {
    const raw = (symbol ?? "").trim();
    if (!raw) return null;
    const exact = prices.usd[raw];
    if (usable(exact)) return exact;
    const hit = lower.get(raw.toLowerCase());
    return hit === undefined ? null : hit;
  };
}

/**
 * Fetch spot prices.
 *
 * Returns null instead of throwing. A page that cannot price its rows has to
 * render them as unknown, not fail to render — every consumer of this already
 * has a null path for "this asset has no price", and a dead feed lands in the
 * same place. Aborts are rethrown so a caller's cleanup still works.
 */
export async function fetchSpotPrices(
  signal?: AbortSignal,
): Promise<SpotPrices | null> {
  try {
    const res = await fetch("/api/prices/spot", { signal, cache: "no-store" });
    const body = await res.json();
    if (!res.ok || !body?.success) return null;
    const data = body.data as SpotPrices | undefined;
    if (!data || typeof data.usd !== "object" || data.usd === null) return null;
    return data;
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") throw err;
    console.error(
      "[spot] price fetch failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
