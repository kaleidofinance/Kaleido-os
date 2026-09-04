/**
 * Simplified Uniswap V3 Math Helpers
 *
 * Two frames of reference run through this file, and mixing them is the class
 * of bug it exists to prevent.
 *
 * The *pool* frame is the pair sorted by address, which is the only order the
 * contracts know: price is token1/token0 with token0 < token1, and slot0.tick
 * is quoted in it. The *user* frame is the pair in whatever order the UI shows
 * it, which is the order the price inputs are labelled with. The two agree
 * exactly half the time, by address. Crossing between them is
 * `poolOrderInverted` plus `invertTickRange` — never one without the other.
 */

export const TICK_SPACINGS: { [fee: number]: number } = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
};

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

/**
 * Whether the caller's (a, b) order disagrees with the pool's.
 *
 * The factory sorts by address, so a pair the UI shows as KLD/USDC can be
 * USDC/KLD on-chain. Everything read from or written to a pool is quoted in
 * the sorted order, so a tick derived from a user-facing price means nothing to
 * a contract until it has been inverted, and nothing to a user until it has
 * been inverted back.
 */
export function poolOrderInverted(tokenA: string, tokenB: string): boolean {
  return tokenA.toLowerCase() > tokenB.toLowerCase();
}

/**
 * The same price range seen from the other side of the pair.
 *
 * Swapping the denominator inverts the price, and a tick is its logarithm, so
 * the tick negates: 1/p sits at -tick. Negation reverses order, so the bounds
 * trade places too — a range's lower edge in one frame is its upper edge in the
 * other. Doing half of this (negating without swapping, or swapping without
 * negating) mints a range on the wrong side of the market, and nothing reverts
 * to say so.
 */
export function invertTickRange(
  tickLower: number,
  tickUpper: number,
): { tickLower: number; tickUpper: number } {
  return { tickLower: -tickUpper, tickUpper: -tickLower };
}

/**
 * The widest range a pool will actually accept at a given fee tier.
 *
 * MIN_TICK/MAX_TICK are multiples of no tick spacing, and `flipTick`
 * (dex-v3/core/libraries/TickBitmap.sol:31) requires `tick % tickSpacing == 0`
 * as a bare require with no reason string. A fresh position flips both of its
 * ticks, so minting at the raw bounds reverts unexplained on every fee tier
 * this app offers — 887272 leaves a remainder against spacings 10, 60 and 200
 * alike. Aligning inward costs under one spacing of range at each end.
 */
export function fullRangeTicks(spacing: number): {
  tickLower: number;
  tickUpper: number;
} {
  const max = Math.floor(MAX_TICK / spacing) * spacing;
  return { tickLower: -max, tickUpper: max };
}

/**
 * Converts a price to a V3 tick
 * Price is token1/token0
 */
export function priceToTick(
  price: number,
  decimals0: number,
  decimals1: number,
): number {
  if (price <= 0) return 0;

  // Uniswap V3: human_price = (1.0001^tick) * 10^(decimals0 - decimals1)
  // Therefore: 1.0001^tick = human_price * 10^(decimals1 - decimals0)
  const adjustedPrice = price * Math.pow(10, decimals1 - decimals0);
  const tick = Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));

  return Math.max(MIN_TICK, Math.min(MAX_TICK, tick));
}

/**
 * Converts a V3 tick to a price
 */
export function tickToPrice(
  tick: number,
  decimals0: number,
  decimals1: number,
): number {
  const priceBase = Math.pow(1.0001, tick);
  return priceBase * Math.pow(10, decimals0 - decimals1);
}

/**
 * Is this tick past the last price any position could span?
 *
 * A swap that exhausts every position in its path does not revert — it clamps.
 * The pool walks its price to `MIN_SQRT_RATIO + 1` or `MAX_SQRT_RATIO - 1` and
 * stops there, leaving `slot0` at a tick of ±887271 and holding dust of whichever
 * token ran out. Measured on the Robinhood Testnet KLD/USDC 0.30% pool: one 117
 * USDC buy took all the KLD, and `tickToPrice` on the tick it left behind reads
 * 3.4e50 USDC per KLD — which is 2^128 in disguise, not a market.
 *
 * The test is not a plausibility threshold. `fullRangeTicks` is the widest range a
 * mint will accept at this tier, so a tick outside it is a price no position can
 * ever sit at — not "implausibly far" but unreachable — which makes it the exact
 * line between a thin market and the contract's own clamp, and it moves with the
 * fee tier the way the mintable range does.
 *
 * `>=` on the magnitude, not `>`: the clamp lands one tick inside `MAX_TICK`, and
 * a pool sitting exactly on the outermost mintable tick has no room either side of
 * it. An unknown fee falls back to the raw bound, which still catches a clamped
 * pool. A non-finite tick counts as pinned because no price follows from it, and
 * every caller wants the same refusal for both.
 */
export function isTickPinned(tick: number, fee: number): boolean {
  if (!Number.isFinite(tick)) return true;
  const spacing = TICK_SPACINGS[fee];
  const outermost = spacing ? fullRangeTicks(spacing).tickUpper : MAX_TICK - 1;
  return Math.abs(tick) >= outermost;
}

/**
 * Snaps a tick to the nearest valid tick based on fee tier spacing.
 *
 * `Math.round` on the compressed tick, rather than floor with a sign branch:
 * the branch subtracted half a spacing for negative ticks *and* floored, which
 * rounds away from zero and so landed a whole spacing low every time — tick
 * -100 at spacing 60 snapped to -180 when -120 is nearer. Any range below
 * parity was shifted down, and shifted asymmetrically whenever one bound was
 * negative and the other was not.
 */
export function nearestUsableTick(tick: number, spacing: number): number {
  const rounded = Math.round(tick / spacing) * spacing;
  if (rounded < MIN_TICK) return rounded + spacing;
  if (rounded > MAX_TICK) return rounded - spacing;
  // Rounding a small negative tick yields -0, which is numerically fine and
  // reads as a mistake in a logged mint param.
  return rounded === 0 ? 0 : rounded;
}

/**
 * The token1/token0 amount ratio a V3 range actually consumes at a given price,
 * in human units and in whatever token order the caller is using.
 *
 * A concentrated position does not take deposits in the ratio the depositor
 * happens to type; the pool takes `min(L(amount0), L(amount1))` worth and
 * leaves the rest of the over-supplied side untouched. This is the number that
 * says which side binds, and therefore the only basis on which a slippage floor
 * for `mint` can be computed — a floor derived from the raw inputs would revert
 * every deposit whose ratio was off by more than the tolerance, which for two
 * independently typed amounts is nearly all of them.
 *
 * Returns:
 *   - a finite positive ratio in range,
 *   - `0` when the price is at or below the range, where the position is all
 *     token0 and consumes no token1,
 *   - `Infinity` when the price is at or above the range, where it is all
 *     token1 and consumes no token0,
 *   - `NaN` when the inputs cannot describe a range at all. Callers must treat
 *     this as "unknown" rather than as a ratio; it used to share the `0` return
 *     with the legitimate all-token0 case, which made a bad price look like a
 *     one-sided deposit.
 *
 * The two boundary returns were previously the wrong way round — at or below
 * the lower bound it returned 999999999 and at or above the upper bound it
 * returned 0 — while the comments beside them described the correct behaviour.
 * The formula itself already tends to 0 as sqrtP approaches sqrtL and diverges
 * as it approaches sqrtU, so the early returns were contradicting the line
 * below them. Nothing consumed this function at the time, so the inversion was
 * latent rather than shipped.
 */
export function getV3AmountRatio(
  currentPrice: number,
  minPrice: number,
  maxPrice: number,
  decimals0: number,
  decimals1: number,
): number {
  if (
    !Number.isFinite(currentPrice) ||
    !Number.isFinite(minPrice) ||
    !Number.isFinite(maxPrice) ||
    currentPrice <= 0 ||
    minPrice <= 0 ||
    maxPrice <= 0 ||
    maxPrice <= minPrice
  ) {
    return NaN;
  }

  // Convert human prices to sqrtPrices
  const scale = Math.pow(10, decimals1 - decimals0);
  const sqrtP = Math.sqrt(currentPrice * scale);
  const sqrtL = Math.sqrt(minPrice * scale);
  const sqrtU = Math.sqrt(maxPrice * scale);

  if (sqrtP <= sqrtL) return 0; // at or below the range — all token0
  if (sqrtP >= sqrtU) return Infinity; // at or above the range — all token1

  // Liquidity math ratio: amount1 / amount0 = (sqrtP * sqrtU * (sqrtP - sqrtL)) / (sqrtU - sqrtP)
  const ratio = (sqrtP * sqrtU * (sqrtP - sqrtL)) / (sqrtU - sqrtP);
  return ratio / scale;
}
