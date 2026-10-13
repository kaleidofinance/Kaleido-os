/**
 * Valuing a wallet's IN-RANGE liquidity for the time-based `lp` points source —
 * the pure parts, so the "in-range only" rule and the USD maths are tested off
 * the chain. The route reads positions and pool prices; this decides what each
 * one is worth right now, and sums per owner.
 *
 * WHY IN-RANGE ONLY. `lp` rewards liquidity that is actually doing work — quoting
 * both sides at the current price. A position whose range no longer contains the
 * price has been converted entirely to one token and is quoting nothing, so it
 * earns nothing until it comes back in range. `positionAmounts` still reports the
 * one-sided balance of an out-of-range position (correct for a portfolio), so the
 * in-range gate lives HERE, not there.
 */

import { positionAmounts } from "@/lib/dex/positionValue";

/** A position as read from the NonfungiblePositionManager, plus its pool tokens'
 *  decimals. Amounts/liquidity are bigints; ticks are numbers. */
export interface RawPosition {
  tokenId: bigint;
  owner: string;
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

/** The pool's current price, read once per pool per run. */
export interface PoolState {
  tick: number;
  sqrtPriceX96: bigint;
}

/**
 * Is the pool price inside the position's range? Uniswap's convention is
 * half-open [tickLower, tickUpper): a position is active when
 * `tickLower <= tick < tickUpper`, matching how the pool itself decides whether a
 * position's liquidity is in the active tick.
 */
export function isInRange(
  tick: number,
  tickLower: number,
  tickUpper: number,
): boolean {
  return tick >= tickLower && tick < tickUpper;
}

/**
 * A single position's in-range USD, or 0 when it earns nothing: empty (liquidity
 * 0), out of range, or unpriceable. A leg with no price is left out rather than
 * guessed. Never null — a position that earns nothing is a real $0, not unknown.
 */
export function positionUsd(args: {
  position: RawPosition;
  pool: PoolState;
  price0: number | null;
  price1: number | null;
}): number {
  const { position: p, pool } = args;
  if (p.liquidity <= 0n) return 0;
  if (!isInRange(pool.tick, p.tickLower, p.tickUpper)) return 0;

  const amounts = positionAmounts({
    sqrtPriceX96: pool.sqrtPriceX96.toString(),
    tickLower: p.tickLower,
    tickUpper: p.tickUpper,
    liquidity: p.liquidity.toString(),
    decimals0: p.decimals0,
    decimals1: p.decimals1,
  });
  if (!amounts) return 0;

  let usd = 0;
  if (args.price0 !== null && args.price0 > 0) usd += amounts.amount0 * args.price0;
  if (args.price1 !== null && args.price1 > 0) usd += amounts.amount1 * args.price1;
  return usd > 0 ? usd : 0;
}

/**
 * Sum in-range USD per owner across many positions — one wallet can hold several.
 * A wallet whose total is 0 is dropped, so only wallets actually providing
 * liquidity get a snapshot row.
 */
export function usdByOwner(
  entries: Array<{ owner: string; usd: number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const { owner, usd } of entries) {
    if (!(usd > 0)) continue;
    const key = owner.toLowerCase();
    out.set(key, (out.get(key) ?? 0) + usd);
  }
  return out;
}
