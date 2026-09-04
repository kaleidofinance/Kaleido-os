/**
 * Uniswap V3's tick/sqrtPrice conversions, in BigInt.
 *
 * Extracted from seed-v3-pool.js when reprice-v3-pool.js needed the same four
 * functions. Copying them would have been the wrong kind of cheap: the two
 * scripts have to agree on the tick a given price maps to, or the one that moves
 * the price and the one that centres a position on it disagree by a tick or two
 * and the fresh liquidity opens just outside the market it was minted for.
 *
 * Nothing here calls a node. `sqrtRatioAtTick` is the Solidity library's job in
 * production; these exist because TickMath is Solidity and a script cannot call
 * an internal library function.
 */

/** Uniswap V3's absolute tick bounds. */
const MIN_TICK = -887272;
const MAX_TICK = 887272;

/**
 * Integer square root by Newton's method.
 *
 * Needed because sqrtPriceX96 is a Q64.96 fixed-point value and the intermediate
 * `amount1 << 192` overflows every float long before it overflows a BigInt.
 * Doing this in Number would silently lose the low bits of the price.
 */
function sqrtBig(n) {
  if (n < 0n) throw new Error("sqrt of a negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Uniswap's encodeSqrtRatioX96: the price of token0 in token1, as Q64.96. */
function encodeSqrtRatioX96(amount1, amount0) {
  return sqrtBig((amount1 << 192n) / amount0);
}

/**
 * sqrt(1.0001^tick) * 2^96, computed in BigInt.
 *
 * 1.0001^tick is irrational, so it is built by repeated squaring over a rational
 * approximation held at 128 bits of extra precision. The error is far below one
 * tick, which is all the bisection below needs.
 */
const Q96 = 1n << 96n;
const PREC = 1n << 128n;
function sqrtRatioAtTick(tick) {
  const abs = BigInt(Math.abs(tick));
  /* sqrt(1.0001) as a PREC-scaled rational, from sqrt(1.0001 * PREC^2). */
  let ratio = PREC;
  let base = sqrtBig((10001n * PREC * PREC) / 10000n);
  let n = abs;
  while (n > 0n) {
    if (n & 1n) ratio = (ratio * base) / PREC;
    base = (base * base) / PREC;
    n >>= 1n;
  }
  if (tick < 0) ratio = (PREC * PREC) / ratio;
  return (ratio * Q96) / PREC;
}

/**
 * The tick whose price is closest to this sqrtPriceX96, found by bisection.
 *
 * The closed form needs a base-1.0001 logarithm and Uniswap's own TickMath is a
 * Solidity library, so the tick is searched for instead: getSqrtRatioAtTick is
 * monotonic, and 41 halvings of the full ±887272 range land exactly. Slower than
 * a log and immune to the floating-point error that would put a position's range
 * one tick off the price just set.
 *
 * `sqrtAtTick` is a parameter rather than the module's own function so a caller
 * can pass the pool's view of it; every caller here passes `sqrtRatioAtTick`.
 */
function tickAtSqrtRatio(sqrtPriceX96, sqrtAtTick = sqrtRatioAtTick) {
  /* Bounds first: outside them the bisection would silently return an endpoint
     rather than admit the price is unrepresentable, and a pool initialised at an
     endpoint tick is one the price can only move away from. */
  if (
    sqrtPriceX96 < sqrtAtTick(MIN_TICK) ||
    sqrtPriceX96 > sqrtAtTick(MAX_TICK)
  )
    throw new Error(
      `sqrtPriceX96 ${sqrtPriceX96} is outside V3's representable range — check the decimals on both sides`,
    );
  let lo = MIN_TICK;
  let hi = MAX_TICK;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (sqrtAtTick(mid) <= sqrtPriceX96) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

module.exports = {
  MIN_TICK,
  MAX_TICK,
  sqrtBig,
  encodeSqrtRatioX96,
  sqrtRatioAtTick,
  tickAtSqrtRatio,
};
