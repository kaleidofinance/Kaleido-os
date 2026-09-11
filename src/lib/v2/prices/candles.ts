/**
 * KLD's price, as candles, out of our own V3 pool's swaps.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AND WHY IT IS NOT A COINGECKO FEED
 * ---------------------------------------------------------------------------
 * `feeds.ts` prices thirteen symbols through CoinGecko and deliberately omits
 * KLD, kfUSD, kafUSD and stKLD — there is no market to quote. That note says
 * they "have no deployment", which was true when it was written and is not now:
 * KLD is deployed on five chains with a KLD/USDC V3 pool on most of them. A
 * listing will still never exist for a testnet token, so the only honest price
 * for KLD is the one our own pool last traded at.
 *
 * ---------------------------------------------------------------------------
 * THE POOLS ARE V3, WHICH DECIDES EVERYTHING BELOW
 * ---------------------------------------------------------------------------
 * `usePriceHistory` reads V2 `Sync` events off a pair. There is no pair — read
 * on chain, Sepolia's KLD market is `0x04EfB41F…` and Base Sepolia's is
 * `0x32C3E8E8…`, and both answer `fee()`, so both are V3. The event that
 * carries a price is `Swap(…, sqrtPriceX96, liquidity, tick)`, and the `tick`
 * is what this module turns into money.
 *
 * Nothing here does its own tick arithmetic. `tickToPrice`, `isTickPinned` and
 * the tick spacings all live in constants/utils/v3Math.ts and are covered by
 * `test:v3math`; a second implementation would be a second answer.
 *
 * ---------------------------------------------------------------------------
 * THE TWO WAYS THIS SILENTLY PRODUCES A WRONG CHART
 * ---------------------------------------------------------------------------
 * 1. TOKEN ORDER FLIPS BETWEEN CHAINS. A V3 pool orders its tokens by address,
 *    so the same pair lands differently on different deployments: KLD is
 *    token0 on Base Sepolia and token1 on Sepolia. `tickToPrice` always returns
 *    token1-per-token0, so on one chain that is USDC per KLD and on the other
 *    it is KLD per USDC — the same formula, the chart upside down on half the
 *    deployments, and every number still plausible. `priceFromTick` takes
 *    `kldIsToken0` and normalises, so callers only ever see USDC per KLD.
 *
 * 2. DECIMALS ARE 18 AGAINST 6. The `10^(decimals0 - decimals1)` term is 10^12
 *    one way and 10^-12 the other. Getting it backwards is not a rounding
 *    error, and it is not visible as one either — it is a chart with an axis.
 *
 * ---------------------------------------------------------------------------
 * AND THE ONE WAY THE DATA ITSELF LIES
 * ---------------------------------------------------------------------------
 * A pool this thin can be emptied by one trade. The pool does not revert when a
 * swap exhausts every position in its path — it walks its price to the end of
 * the range and stops, leaving a tick at the contract's own clamp. v3Math
 * records the measurement: on the Robinhood KLD/USDC 0.30% pool, one 117 USDC
 * buy took all the KLD and left a tick reading 3.4e50 USDC per KLD.
 *
 * So a pinned tick is DROPPED, never clamped to something plausible. A bucket
 * whose swaps were all pinned therefore has no price at all, which is a
 * different fact from a flat one and is returned as the absence of a candle
 * rather than a candle repeating the last close. Inventing a price for a
 * fifteen minutes in which nothing legible happened is the one thing a chart
 * drawn from our own pool must not do.
 */
import { isTickPinned, tickToPrice } from "@/constants/utils/v3Math";

/** Bucket widths, in seconds. The set the chart offers. */
export const INTERVALS = {
  "15m": 900,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
} as const;

export type Interval = keyof typeof INTERVALS;

export const isInterval = (x: unknown): x is Interval =>
  typeof x === "string" && x in INTERVALS;

/**
 * One swap, reduced to the three things a candle needs.
 *
 * `logIndex` is not decoration. Two swaps in one block are ordered only by it,
 * and open and close are defined by that order — a bucket sorted by block alone
 * opens and closes on whichever of them the RPC happened to return first.
 */
export interface SwapTick {
  blockNumber: number;
  logIndex: number;
  /** Unix seconds, from the block. */
  timestamp: number;
  /** `Swap.tick` — the pool's tick AFTER the swap. */
  tick: number;
}

/** What the pool is, for reading its ticks as money. */
export interface PoolShape {
  /** Which side KLD sits on. Chain-specific; see the header. */
  kldIsToken0: boolean;
  decimals0: number;
  decimals1: number;
  /** Fee tier, for the tick spacing `isTickPinned` measures against. */
  fee: number;
}

/**
 * The wire shape of GET /api/prices/kld. Here rather than in the route so the
 * route exports only its handler — a route segment that exports a stray type
 * trips the Next build — and so the client hook imports it without importing
 * anything server-side.
 */
export interface KldCandleResponse {
  chainId: number;
  pool: string | null;
  interval: Interval;
  candles: Candle[];
}

export interface Candle {
  /** Bucket start, unix seconds. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Swaps that produced this candle. One is a print, not a market. */
  n: number;
}

/**
 * USDC per KLD from a pool tick, or null when the tick is not a price.
 *
 * Null has one meaning — the pool was sitting at its own clamp — and callers
 * must drop the swap rather than substitute anything for it.
 */
export function priceFromTick(tick: number, pool: PoolShape): number | null {
  if (isTickPinned(tick, pool.fee)) return null;

  const token1PerToken0 = tickToPrice(tick, pool.decimals0, pool.decimals1);
  if (!Number.isFinite(token1PerToken0) || token1PerToken0 <= 0) return null;

  /* tickToPrice is always token1 per token0. With KLD as token0 that is already
     USDC per KLD; with KLD as token1 it is the reciprocal. */
  const usdcPerKld = pool.kldIsToken0
    ? token1PerToken0
    : 1 / token1PerToken0;

  return Number.isFinite(usdcPerKld) && usdcPerKld > 0 ? usdcPerKld : null;
}

/** The bucket a timestamp falls in, as its start in unix seconds. */
export function bucketStart(timestamp: number, interval: Interval): number {
  const width = INTERVALS[interval];
  return Math.floor(timestamp / width) * width;
}

/**
 * Swaps to candles, in ascending time.
 *
 * Sorts before bucketing rather than trusting the caller: an incremental
 * indexer appends whatever a `getLogs` page returned, and a resumed scan can
 * hand back a page that overlaps the previous one. Sorting makes open and close
 * correct regardless, and the `(block, logIndex)` pair also dedupes — the same
 * swap seen twice across a resume boundary must not count twice in `n`.
 *
 * Gaps are left as gaps. A fifteen minutes with no legible swap produces no
 * candle, so a reader can tell a quiet market from a flat one.
 */
export function candlesFrom(
  swaps: SwapTick[],
  interval: Interval,
  pool: PoolShape,
): Candle[] {
  const seen = new Set<string>();
  const ordered = [...swaps]
    .filter((s) => {
      const key = `${s.blockNumber}:${s.logIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : a.blockNumber - b.blockNumber,
    );

  const byBucket = new Map<number, Candle>();

  for (const swap of ordered) {
    const price = priceFromTick(swap.tick, pool);
    if (price === null) continue; // clamped: not a price, see the header

    const t = bucketStart(swap.timestamp, interval);
    const open = byBucket.get(t);

    if (!open) {
      byBucket.set(t, { t, o: price, h: price, l: price, c: price, n: 1 });
      continue;
    }
    /* Ordered above, so this swap is later than everything already folded in:
       close moves, open never does. */
    open.c = price;
    if (price > open.h) open.h = price;
    if (price < open.l) open.l = price;
    open.n += 1;
  }

  return [...byBucket.values()].sort((a, b) => a.t - b.t);
}

/**
 * Merges freshly scanned candles into stored ones, newest wins per bucket.
 *
 * The indexer re-scans the bucket it is currently inside on every run, because
 * that bucket is still open and its close moves. Re-folding a closed bucket is
 * harmless and this is what makes the cron idempotent: firing twice writes the
 * same rows rather than doubling `n`.
 */
export function mergeCandles(stored: Candle[], fresh: Candle[]): Candle[] {
  const byT = new Map<number, Candle>(stored.map((c) => [c.t, c]));
  for (const c of fresh) byT.set(c.t, c);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/**
 * Rolls base candles up into a coarser interval.
 *
 * This is what lets only the 15m base be stored. OHLC composes: an hour's open
 * is its first base candle's open, its close the last's close, its high and low
 * the extremes across them, and its `n` the sum — identical to an hour computed
 * from the swaps directly, because open and close are the earliest and latest
 * prices either way. So the store keeps one granularity and the chart asks for
 * any coarser one without a second pass over swaps.
 *
 * The base is assumed to divide the target, which every offered interval does
 * (15m into 1h, 4h, 1d). A target equal to or finer than the base returns the
 * base sorted, since there is nothing to combine.
 *
 * Gaps stay gaps here too: an hour with two of its four 15m candles present
 * produces one candle spanning what traded, not four with two invented. `n`
 * therefore counts real swaps, and a reader can still tell a thin hour from a
 * full one.
 */
export function aggregateCandles(base: Candle[], target: Interval): Candle[] {
  const width = INTERVALS[target];
  const byBucket = new Map<number, Candle[]>();

  for (const c of base) {
    const t = Math.floor(c.t / width) * width;
    const group = byBucket.get(t);
    if (group) group.push(c);
    else byBucket.set(t, [c]);
  }

  const out: Candle[] = [];
  for (const [t, group] of byBucket) {
    /* Sorted so open and close come from the ends, not from insertion order —
       the same reason candlesFrom sorts before folding. */
    group.sort((a, b) => a.t - b.t);
    out.push({
      t,
      o: group[0].o,
      c: group[group.length - 1].c,
      h: Math.max(...group.map((g) => g.h)),
      l: Math.min(...group.map((g) => g.l)),
      n: group.reduce((sum, g) => sum + g.n, 0),
    });
  }

  return out.sort((a, b) => a.t - b.t);
}
