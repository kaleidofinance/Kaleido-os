/**
 * What a V3 position actually holds, in human units.
 *
 * A concentrated position is a liquidity constant `L` over a tick range, not a
 * pair of balances — the NFT knows `liquidity`, `tickLower` and `tickUpper`, and
 * the split between the two tokens depends entirely on where the pool's price
 * sits inside that range right now. So "you have 0.4 ETH and 900 USDC in this
 * pool" is a derived figure, and this file derives it. /portfolio needs it
 * because an LP row that shows only a tick range and a liquidity constant tells
 * a reader nothing about how much money is in it.
 *
 * DISPLAY ONLY — NEVER FOR SIGNING
 *
 * Everything here is IEEE double arithmetic on values that are `uint128` and
 * `uint160` on-chain: `Number(sqrtPriceX96) / 2**96` throws away everything past
 * the 53rd significant bit, and `1.0001 ** (tick / 2)` is a floating-point
 * exponential where the contracts use an exact fixed-point ladder. The relative
 * error is around 1e-16 either way, which is invisible in a dollar figure and
 * unacceptable in a `mint`, `burn` or `collect` argument. Nothing in this module
 * may be used to build a transaction: `decreaseLiquidity` takes the liquidity
 * constant itself, and a slippage floor must come from the exact path in
 * `lib/dex/deposit.ts`. The rule is the same one `getV3AmountRatio` follows and
 * for the same reason — this answers "what is it worth", not "what do I send".
 *
 * THE FRAME
 *
 * All of this is the POOL frame: token0/token1 sorted by address, price quoted as
 * token1 per token0, exactly as `slot0` and `positions()` report them. There is
 * no user-frame variant on purpose — a caller displaying the pair in the other
 * order should swap the two returned amounts, not re-derive them, because
 * inverting ticks and forgetting to swap the bounds is the bug `v3Math`'s header
 * warns about.
 */

import { MAX_TICK, MIN_TICK } from "@/constants/utils/v3Math";

/** 2^96, the fixed-point scale `sqrtPriceX96` is quoted in. */
const Q96 = 2 ** 96;

export interface PositionAmounts {
  /** token0 held, in human units (already divided by 10^decimals0). */
  amount0: number;
  /** token1 held, in human units. */
  amount1: number;
}

export interface PositionAmountsInput {
  /** `slot0().sqrtPriceX96` as a decimal string, or null when unread. */
  sqrtPriceX96: string | null;
  tickLower: number;
  tickUpper: number;
  /** The position's liquidity constant as a decimal string. */
  liquidity: string;
  decimals0: number;
  decimals1: number;
}

const usableNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const usableDecimals = (v: unknown): v is number =>
  usableNumber(v) && Number.isInteger(v) && v >= 0 && v <= 36;

/**
 * The two token amounts a position holds at the pool's current price.
 *
 * Returns null when the inputs cannot describe a position — an unread
 * `sqrtPriceX96`, a range that is not strictly increasing, ticks outside the
 * protocol's bounds, unparseable numbers, or decimals that are not plausible
 * ERC20 decimals. Null means "unknown", and a caller must render it as unknown
 * rather than as zero: a position whose pool price could not be read is not an
 * empty position, and summing it as $0 understates a portfolio while looking
 * like a measurement.
 *
 * A liquidity of exactly 0 is NOT null — it is a real, empty position (one whose
 * liquidity has been withdrawn but whose NFT still exists), and it returns
 * `{ amount0: 0, amount1: 0 }`. Distinguishing those two is the whole reason for
 * the nullable return.
 *
 * Out of range, the position is one-sided and the maths says so by itself: the
 * price is clamped into `[sqrtL, sqrtU]`, so above the range `sqrtP === sqrtU`
 * drives `amount0` to 0 and below it `sqrtP === sqrtL` drives `amount1` to 0.
 * That clamp is the position's actual state, not an approximation — once price
 * leaves the range the pool has already converted the whole position to one side.
 */
export function positionAmounts(
  input: PositionAmountsInput,
): PositionAmounts | null {
  const { sqrtPriceX96, tickLower, tickUpper, liquidity } = input;
  const { decimals0, decimals1 } = input;

  if (!usableDecimals(decimals0) || !usableDecimals(decimals1)) return null;
  if (!usableNumber(tickLower) || !usableNumber(tickUpper)) return null;
  if (tickUpper <= tickLower) return null;
  if (tickLower < MIN_TICK || tickUpper > MAX_TICK) return null;

  /* `Number("")` and `Number(null)` are both 0, and a zero liquidity is a
     meaningful answer here — so the emptiness check has to come before the
     numeric one, otherwise a missing field would render as an empty position. */
  if (typeof liquidity !== "string" || liquidity.trim() === "") return null;
  const L = Number(liquidity);
  if (!Number.isFinite(L) || L < 0) return null;
  if (L === 0) return { amount0: 0, amount1: 0 };

  if (typeof sqrtPriceX96 !== "string" || sqrtPriceX96.trim() === "")
    return null;
  const sqrtPRaw = Number(sqrtPriceX96) / Q96;
  if (!Number.isFinite(sqrtPRaw) || sqrtPRaw <= 0) return null;

  /* sqrt(1.0001^tick) written as 1.0001^(tick/2): the same value, and it keeps
     the exponent inside double range at the extreme ticks where 1.0001^887272
     would not be (1.0001^443636 is ~1.8e19, its square is not representable as
     the intermediate the naive form would compute). */
  const sqrtL = 1.0001 ** (tickLower / 2);
  const sqrtU = 1.0001 ** (tickUpper / 2);
  if (!Number.isFinite(sqrtL) || !Number.isFinite(sqrtU) || sqrtL <= 0)
    return null;

  const sqrtP = Math.min(Math.max(sqrtPRaw, sqrtL), sqrtU);

  /* The standard V3 identities, in raw base units:
       amount0 = L * (sqrtU - sqrtP) / (sqrtP * sqrtU)
       amount1 = L * (sqrtP - sqrtL)
     Both are non-negative given the clamp above; `Math.max(0, …)` guards the
     last-bit case where a clamped sqrtP lands a rounding step past its bound. */
  const raw0 = Math.max(0, (L * (sqrtU - sqrtP)) / (sqrtP * sqrtU));
  const raw1 = Math.max(0, L * (sqrtP - sqrtL));
  if (!Number.isFinite(raw0) || !Number.isFinite(raw1)) return null;

  return {
    amount0: raw0 / 10 ** decimals0,
    amount1: raw1 / 10 ** decimals1,
  };
}

/**
 * A position's USD value, or null when it cannot be measured.
 *
 * A leg holding zero needs no price — that is the point of taking the amounts
 * rather than the symbols. An out-of-range position is entirely one token, so a
 * range that has moved fully into USDC is worth a knowable amount even when the
 * other leg is something with no feed at all (USDe, KLD before TGE). Only a leg
 * that holds something and has no price makes the total unknowable, and then the
 * answer is null rather than a partial sum — half of a position's value
 * presented as its value is worse than an em dash.
 */
export function positionValueUsd(
  amounts: PositionAmounts | null,
  price0: number | null,
  price1: number | null,
): number | null {
  if (!amounts) return null;

  const leg = (amount: number, price: number | null): number | null => {
    if (!usableNumber(amount) || amount <= 0) return 0;
    if (price === null || !Number.isFinite(price) || price <= 0) return null;
    return amount * price;
  };

  const usd0 = leg(amounts.amount0, price0);
  const usd1 = leg(amounts.amount1, price1);
  if (usd0 === null || usd1 === null) return null;

  return usd0 + usd1;
}
