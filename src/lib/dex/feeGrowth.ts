/**
 * A V3 position's uncollected fees, computed the way the pool computes them.
 *
 * `tokensOwed0/1` on the position NFT is only the fees CHECKPOINTED at the last
 * time the position was touched (mint, increase, decrease, collect). Fees earned
 * since then live in the pool's per-tick and global `feeGrowth` accumulators and
 * are not on the NFT at all — so a position that has traded since its last
 * interaction shows stale `tokensOwed`, understating what a `collect` would pay.
 * This module reconstructs the live figure: the fee growth inside the position's
 * range, minus the growth already checkpointed, times the position's liquidity,
 * plus what was already owed.
 *
 * ── WHY BigInt, NOT THE FLOAT MATH IN positionValue.ts ────────────────────────
 *
 * positionValue.ts is deliberately IEEE-double: a position's token split is a
 * ratio where 1e-16 relative error is invisible in a dollar figure. Fee growth is
 * NOT that shape. It is a `uint256` fixed-point accumulator (Q128.128) that is
 * *designed to overflow* — the pool subtracts one snapshot from another and lets
 * the wraparound cancel, so `feeGrowthInside` for a range is routinely a value
 * that only makes sense modulo 2²⁵⁶. Compute any of it in a double and the top
 * bits are gone before the subtraction that was supposed to cancel them, and the
 * answer is not "slightly off" — it is arbitrary. So every intermediate here is a
 * BigInt masked to 256 bits, exactly as the EVM holds it.
 *
 * ── DISPLAY ONLY — NEVER FOR SIGNING ──────────────────────────────────────────
 *
 * Same rule as positionValue.ts, and it matters more here. A `collect` sweeps
 * with `amount0Max = uint128 max` and takes whatever the pool says is owed at
 * execution — it never carries a fee figure this module produced. This answers
 * "how much is sitting uncollected right now", for a portfolio row and a claim
 * proposal. It must not become an argument to a transaction: it is read at one
 * block and the collect lands at another, and the pool is the only authority on
 * the amount at that later block.
 *
 * ── THE FRAME ─────────────────────────────────────────────────────────────────
 *
 * Pool frame throughout: token0/token1 sorted by address, the two amounts return
 * in that order. A caller showing the pair the other way swaps the results.
 */

/** 2^256, the modulus every accumulator below is held under. */
const Q256 = 1n << 256n;
/** Mask to 256 bits — the pool's accumulators are uint256 and wrap at this. */
const MASK256 = Q256 - 1n;
/** 2^128, the fixed-point scale fee growth is quoted in (Q128.128). */
const Q128 = 1n << 128n;

/** Wrapping subtraction in uint256, matching the EVM's unchecked arithmetic. */
const sub256 = (a: bigint, b: bigint): bigint => (a - b) & MASK256;

/**
 * The fee growth accumulated INSIDE a tick range, per unit of liquidity.
 *
 * This is the pool's own `_getFeeGrowthInside`, reproduced. The global
 * accumulator only ever grows; each tick stores the growth that occurred on the
 * *other* side of it (`feeGrowthOutside`), and the growth inside the range is the
 * global minus the part below the lower tick minus the part above the upper tick.
 * Which of a tick's `outside` values counts as "below" or "above" flips depending
 * on where the current price sits relative to that tick — that is the branch on
 * `tickCurrent`, and getting it wrong is the classic silent V3 fee bug.
 *
 * Every term is subtracted modulo 2²⁵⁶ so the intentional wraparound cancels.
 */
function feeGrowthInside(
  tickLower: number,
  tickUpper: number,
  tickCurrent: number,
  feeGrowthGlobalX128: bigint,
  feeGrowthOutsideLowerX128: bigint,
  feeGrowthOutsideUpperX128: bigint,
): bigint {
  /* Below the lower tick: if price is at or above it, the lower tick's `outside`
     is the growth below the range; otherwise the range is entirely above price,
     and the growth below it is global minus the tick's stored value. */
  const below =
    tickCurrent >= tickLower
      ? feeGrowthOutsideLowerX128
      : sub256(feeGrowthGlobalX128, feeGrowthOutsideLowerX128);

  /* Above the upper tick: mirror image. If price is below the upper tick, the
     tick's `outside` already is the growth above the range. */
  const above =
    tickCurrent < tickUpper
      ? feeGrowthOutsideUpperX128
      : sub256(feeGrowthGlobalX128, feeGrowthOutsideUpperX128);

  return sub256(sub256(feeGrowthGlobalX128, below), above);
}

/** The four global + per-tick accumulators for one token, as read from the pool. */
export interface FeeGrowthSnapshot {
  /** `pool.feeGrowthGlobal{0,1}X128()`. */
  feeGrowthGlobalX128: bigint;
  /** `pool.ticks(tickLower).feeGrowthOutside{0,1}X128`. */
  feeGrowthOutsideLowerX128: bigint;
  /** `pool.ticks(tickUpper).feeGrowthOutside{0,1}X128`. */
  feeGrowthOutsideUpperX128: bigint;
}

export interface UncollectedFeesInput {
  tickLower: number;
  tickUpper: number;
  /** `slot0().tick` — where price sits now. */
  tickCurrent: number;
  /** The position's liquidity constant. */
  liquidity: bigint;
  /** `positions(id).feeGrowthInside0LastX128`. */
  feeGrowthInside0LastX128: bigint;
  /** `positions(id).feeGrowthInside1LastX128`. */
  feeGrowthInside1LastX128: bigint;
  /** `positions(id).tokensOwed0` — fees already checkpointed. */
  tokensOwed0: bigint;
  /** `positions(id).tokensOwed1`. */
  tokensOwed1: bigint;
  token0: FeeGrowthSnapshot;
  token1: FeeGrowthSnapshot;
}

/** Uncollected fees in raw base units, per token, in pool order. */
export interface UncollectedFees {
  amount0: bigint;
  amount1: bigint;
}

/**
 * The fees a `collect` would pay right now, in raw base units.
 *
 * For one token: `(feeGrowthInside - feeGrowthInsideLast) * liquidity >> 128`,
 * added to the already-owed checkpoint. The subtraction wraps in uint256 — a
 * position can have a `feeGrowthInsideLast` that is numerically larger than the
 * current inside value, and the wraparound is the pool's own maths, not an error.
 * The `>> 128` un-scales the Q128 fixed point after the multiply, in that order,
 * so no precision is lost before the shift.
 *
 * Returns null only on inputs that cannot describe a position — a non-increasing
 * range or negative liquidity. A liquidity of 0 is valid and returns just the
 * owed checkpoints (a withdrawn position can still hold uncollected fees).
 */
export function uncollectedFees(
  input: UncollectedFeesInput,
): UncollectedFees | null {
  const { tickLower, tickUpper, tickCurrent, liquidity } = input;
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) return null;
  if (!Number.isInteger(tickCurrent)) return null;
  if (tickUpper <= tickLower) return null;
  if (liquidity < 0n) return null;

  const owed = (
    snap: FeeGrowthSnapshot,
    insideLast: bigint,
    tokensOwed: bigint,
  ): bigint => {
    const inside = feeGrowthInside(
      tickLower,
      tickUpper,
      tickCurrent,
      snap.feeGrowthGlobalX128,
      snap.feeGrowthOutsideLowerX128,
      snap.feeGrowthOutsideUpperX128,
    );
    /* The delta wraps too: `inside` and `insideLast` are both snapshots of an
       accumulator that overflows, so their difference is only meaningful mod
       2²⁵⁶. Multiply by L, then shift down the Q128 scale. */
    const delta = sub256(inside, insideLast);
    const earned = (delta * liquidity) >> 128n;
    return tokensOwed + earned;
  };

  return {
    amount0: owed(input.token0, input.feeGrowthInside0LastX128, input.tokensOwed0),
    amount1: owed(input.token1, input.feeGrowthInside1LastX128, input.tokensOwed1),
  };
}

/**
 * Raw base units → human units as a float, for display and pricing only.
 *
 * The BigInt above is the exact figure; this is the lossy last step, isolated so
 * the exactness is not spent before it has to be. A fee amount is a `uint128` at
 * most, so the division is well inside double range for any real position, and
 * the ~1e-16 error is the same one positionValue.ts already accepts for a dollar
 * figure. Never feed the result back into a transaction.
 */
export function feeAmountToNumber(raw: bigint, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return NaN;
  /* Divide as BigInt down to a fixed number of fractional digits, then to a
     Number — so a large raw value does not lose its integer part to float before
     the scale is applied. Twelve fractional digits is well past any token's
     display precision and keeps the intermediate inside 2⁵³ for uint128 inputs. */
  const FRAC = 12n;
  const scale = 10n ** BigInt(decimals);
  const scaled = (raw * 10n ** FRAC) / scale;
  return Number(scaled) / 1e12;
}

export { feeGrowthInside as _feeGrowthInside, Q128 as _Q128, MASK256 as _MASK256 };
