/**
 * Which symbols have a price feed, and what each chart range asks for.
 *
 * This is an allowlist before it is a convenience. `/api/prices` makes an
 * outbound request on behalf of whoever calls it, and the id lands inside the
 * upstream URL — so a symbol that arrives from the client is never interpolated
 * anywhere. It is looked up here or the request is refused. Same discipline as
 * `intentsFromChat` and `cardsFromChat`: validate against a known set, drop the
 * rest, never repair.
 *
 * Feeds are keyed by SYMBOL, not by `(chainId, address)`.
 *
 * That is a deliberate exception to the identity rule in tokens.ts, and it is
 * worth being explicit about why it is safe here. Chain-scoping exists because
 * two tokens sharing a symbol can be different assets with different decimals —
 * a fact about *balances and transfers*, where being wrong moves the wrong
 * amount. A chart is a claim about what an asset is worth, and USDC on Base is
 * worth what USDC on Ethereum is worth. Pricing per chain would mean five
 * upstream calls for one number that does not differ.
 *
 * Wrapped and bridged assets are priced as their underlying. WETH is redeemable
 * 1:1 so that is exact; WBTC, cbBTC and BTCB are custodied bridges that track
 * BTC closely but are not the same instrument, and a depeg would not show on
 * this chart. Acceptable for a price display, not acceptable for anything that
 * sizes a position — so the two readers of this file are the chart and Luca's
 * `getPrice`, which quotes a number and never feeds one into an amount. Nothing
 * that builds a signable step reads a price from here: swap sizing goes through
 * `serverQuote`, which asks the pool.
 *
 * Absent on purpose: KLD, kfUSD, kafUSD and stKLD. They have no market because
 * they have no deployment, and inventing a feed id for them would draw a line
 * for an asset that does not exist. Testnet symbols are absent for the same
 * reason — tBNB is not BNB.
 */

/** Windows offered under the plot, shortest first. */
export type PriceRange = "1H" | "1D" | "1W" | "1M" | "1Y";

export const RANGES: readonly PriceRange[] = [
  "1H",
  "1D",
  "1W",
  "1M",
  "1Y",
] as const;

export const DEFAULT_RANGE: PriceRange = "1D";

export interface RangeSpec {
  /** `days` sent upstream. Granularity follows from it and is not requestable. */
  days: number;
  /**
   * Trim the response to this many milliseconds before now, or null to keep it
   * whole. Only 1H needs it: the shortest window the free upstream serves is a
   * day, so an hour is a day fetched and cut.
   */
  window: number | null;
  /** How long a cached response stays fresh, in milliseconds. */
  ttl: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * TTLs are matched to the granularity of the data, not to a single global
 * number. A one-year series is daily closes — re-fetching it every minute would
 * return a byte-identical body and spend a rate-limit token to do it.
 */
export const RANGE_SPECS: Record<PriceRange, RangeSpec> = {
  "1H": { days: 1, window: HOUR, ttl: MINUTE },
  "1D": { days: 1, window: null, ttl: MINUTE },
  "1W": { days: 7, window: null, ttl: 5 * MINUTE },
  "1M": { days: 30, window: null, ttl: 15 * MINUTE },
  "1Y": { days: 365, window: null, ttl: HOUR },
};

/** Symbol (uppercased) to CoinGecko coin id. */
const FEEDS: Record<string, string> = {
  ETH: "ethereum",
  WETH: "ethereum",
  BTC: "bitcoin",
  WBTC: "bitcoin",
  CBBTC: "bitcoin",
  BTCB: "bitcoin",
  BNB: "binancecoin",
  WBNB: "binancecoin",
  POL: "polygon-ecosystem-token",
  WPOL: "polygon-ecosystem-token",
  HYPE: "hyperliquid",
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
};

/** The feed id for a symbol, or null when there is nothing to draw. */
export function feedFor(symbol: string | null | undefined): string | null {
  if (typeof symbol !== "string") return null;
  return FEEDS[symbol.trim().toUpperCase()] ?? null;
}

/**
 * Every symbol that can be priced, for telling a caller what it could have
 * asked for.
 *
 * Derived from `FEEDS` rather than written out again — a hand-kept second list
 * is a list that eventually disagrees with the first, and this one is quoted
 * back to users. Luca's `getPrice` returns it on an unknown symbol so the model
 * can name the alternatives instead of guessing at what exists.
 */
export const PRICED_SYMBOLS: readonly string[] = Object.keys(FEEDS);

/** True when this symbol can be charted at all. */
export const hasFeed = (symbol: string | null | undefined): boolean =>
  feedFor(symbol) !== null;

export const isPriceRange = (x: unknown): x is PriceRange =>
  typeof x === "string" && (RANGES as readonly string[]).includes(x);

/**
 * A price point on the wire: `[epoch ms, usd]`.
 *
 * A pair rather than `{ t, p }` because a year of daily closes is 365 of them
 * and the object form more than doubles the payload for no added meaning.
 */
export type WirePoint = [number, number];

export interface PriceSeriesResponse {
  symbol: string;
  range: PriceRange;
  points: WirePoint[];
}
