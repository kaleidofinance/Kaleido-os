/**
 * KaleidoSwap V2 execution maths, in TypeScript.
 *
 * This exists so the pool detail page can draw a depth curve that is not made
 * up. Every other chart Uniswap puts on that page — price, volume, liquidity
 * over time — needs an indexer holding per-block snapshots, which we do not
 * have; `usePoolData` deleted `volumeChange24h`, `liquidityChange24h` and
 * `createdAt` for exactly that reason. Depth is the one panel that needs no
 * history at all: every KaleidoSwap V2 pair is constant-product (enforced in
 * `KaleidoSwapPair.sol:243-247`), so the entire curve is determined by the two
 * reserves the pair holds right now and the fee it charges.
 *
 * `amountOut` below is a transcription of
 * `KaleidoSwapLibrary.getAmountOut` (contracts/dex/libraries/KaleidoSwapLibrary.sol:53-60),
 * kept in `bigint` so the integer division truncates where the EVM's does. It is
 * a transcription rather than an approximation on purpose: this function labels
 * the y-axis of a chart a user might size a trade from, and a float version
 * would disagree with the chain in the last places at exactly the trade sizes
 * where the curve gets steep.
 *
 * DO NOT reach for the router's helper instead. `KaleidoSwapRouter.getAmountOut`
 * (periphery/KaleidoSwapRouter.sol:450-456) hardcodes `30` rather than reading
 * the pair's own `swapFee()`, so it mis-quotes every pair that is not on the
 * 0.3% tier. The fee has to arrive from `ITradingPair.feeBps`, which is read
 * from `swapFee()` per pair.
 */

/** `swapFee()`'s denominator — KaleidoSwapPair.sol:243. */
const FEE_DENOMINATOR = 10_000n;

/**
 * Output of a constant-product swap, exactly as the pair would compute it.
 *
 * Null where the Solidity would `require`-revert: a non-positive input, or a
 * pair with an empty leg. Null rather than a throw because both cases are
 * reachable from ordinary UI state — an empty amount field, a pair whose
 * liquidity has been fully withdrawn — and neither is a programming error.
 *
 * @param feeBps The pair's own `swapFee()`, in bps of 10000.
 */
export function amountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
): bigint | null {
  if (amountIn <= 0n) return null;
  if (reserveIn <= 0n || reserveOut <= 0n) return null;
  /* A fee at or above the denominator would zero the numerator and, at exactly
     100%, make every trade return nothing. The contract has no such guard
     because `swapFee()` is owner-set within its own bounds; here it protects the
     chart from a garbage read rather than the pool from a bad fee. */
  const fee = BigInt(Math.round(feeBps));
  if (fee < 0n || fee >= FEE_DENOMINATOR) return null;

  const amountInWithFee = amountIn * (FEE_DENOMINATOR - fee);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
  return numerator / denominator;
}

/**
 * Base units to a display float.
 *
 * Lossy above 2^53, and deliberately so: an 18-decimal reserve of 615 tokens is
 * 6.15e20, well past `Number.MAX_SAFE_INTEGER`, and no float can hold it
 * exactly. The relative error is ~1e-16, which is invisible in a chart
 * coordinate. Never size a transfer with this — `amountOut` above stays in
 * `bigint` precisely so the arithmetic that matters never passes through here.
 */
const toFloat = (raw: bigint, decimals: number): number =>
  Number(raw) / 10 ** decimals;

/** One direction of the pair, as the curve is walked. */
export interface CurveSide {
  reserveIn: bigint;
  reserveOut: bigint;
  decimalsIn: number;
  decimalsOut: number;
}

export interface CurvePoint {
  /** Trade size as a fraction of the input reserve. */
  fraction: number;
  /** Input, in display units. */
  amountIn: number;
  /** Output, in display units. */
  amountOut: number;
  /**
   * What the trade costs against the spot price, as a percentage — fee and
   * curve together. This is the number a trader actually pays, so it is the one
   * the chart plots.
   */
  costPct: number;
  /**
   * The same figure with the fee taken out: the move along the curve alone.
   *
   * Kept separate because the two answer different questions and are easy to
   * confuse. `costPct` tends to the fee as the trade size tends to zero, not to
   * zero — a 0.3% pair charges 0.3% on a dust trade — whereas `impactPct` does
   * tend to zero. Reporting only the second would understate every trade by the
   * fee; reporting only the first would look like a bug at the left edge.
   */
  impactPct: number;
}

/**
 * Log-spaced sample fractions of the input reserve.
 *
 * Log rather than linear because the curve is almost flat across the first
 * couple of percent and then turns hard: linear sampling spends nearly all of
 * its points in the flat part and then jumps across the interesting corner in
 * one segment. Capped at half the reserve — beyond that the output asymptote
 * dominates and the shape stops telling a reader anything they would act on.
 *
 * Exported because the chart labels this domain. The endpoints it draws have to
 * be the declared bounds and not `points[0].fraction` / `points.at(-1).fraction`:
 * the last sample is `exp(logMin + (logMax - logMin) * 39 / 39)`, whose round
 * trip through log and exp lands a few bits either side of 0.5, so a tick
 * filtered on `f <= sampledMax` would appear or vanish on a rounding rather than
 * on anything about the pool.
 */
export const MIN_FRACTION = 0.0001;
export const MAX_FRACTION = 0.5;

/**
 * The pair's execution curve for one direction.
 *
 * Returns an empty array for a pair that cannot quote at all, so a caller can
 * render "no curve" from `length === 0` without re-deriving why.
 */
export function impactCurve(
  side: CurveSide,
  feeBps: number,
  samples = 40,
): CurvePoint[] {
  const { reserveIn, reserveOut, decimalsIn, decimalsOut } = side;
  if (reserveIn <= 0n || reserveOut <= 0n) return [];
  if (samples < 2) return [];

  const inFloat = toFloat(reserveIn, decimalsIn);
  const outFloat = toFloat(reserveOut, decimalsOut);
  if (!(inFloat > 0) || !(outFloat > 0)) return [];

  /* Spot, in output units per input unit. The ratio of the reserves and nothing
     else — this is the price the curve is measured against, not a quoted or
     oracle price. */
  const spot = outFloat / inFloat;

  const points: CurvePoint[] = [];
  const logMin = Math.log(MIN_FRACTION);
  const logMax = Math.log(MAX_FRACTION);

  for (let i = 0; i < samples; i++) {
    const fraction = Math.exp(logMin + ((logMax - logMin) * i) / (samples - 1));

    /* Back to base units to run the real formula. Rounding down keeps the input
       inside the fraction it claims to be; a zero here means the fraction is
       smaller than one base unit of the input token, which is a legitimate skip
       rather than a failure. */
    const rawIn = BigInt(Math.floor(fraction * Number(reserveIn)));
    if (rawIn <= 0n) continue;

    const withFee = amountOut(rawIn, reserveIn, reserveOut, feeBps);
    const noFee = amountOut(rawIn, reserveIn, reserveOut, 0);
    if (withFee === null || noFee === null) continue;

    const amtIn = toFloat(rawIn, decimalsIn);
    const amtOut = toFloat(withFee, decimalsOut);
    const amtOutNoFee = toFloat(noFee, decimalsOut);
    if (amtIn <= 0) continue;

    points.push({
      fraction,
      amountIn: amtIn,
      amountOut: amtOut,
      costPct: (1 - amtOut / amtIn / spot) * 100,
      impactPct: (1 - amtOutNoFee / amtIn / spot) * 100,
    });
  }

  return points;
}

/** Both directions at once, which is what the chart draws. */
export interface PoolCurves {
  /** Selling token0 for token1. */
  sell0: CurvePoint[];
  /** Selling token1 for token0. */
  sell1: CurvePoint[];
}

export function poolCurves(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number,
  feeBps: number,
  samples = 40,
): PoolCurves {
  return {
    sell0: impactCurve(
      {
        reserveIn: reserve0,
        reserveOut: reserve1,
        decimalsIn: decimals0,
        decimalsOut: decimals1,
      },
      feeBps,
      samples,
    ),
    sell1: impactCurve(
      {
        reserveIn: reserve1,
        reserveOut: reserve0,
        decimalsIn: decimals1,
        decimalsOut: decimals0,
      },
      feeBps,
      samples,
    ),
  };
}
