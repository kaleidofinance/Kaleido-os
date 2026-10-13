import { AbiCoder, keccak256, getAddress } from "ethers";
import { ARGUS_POOL_FEE, ARGUS_TICK_SPACING } from "./addresses";

/**
 * Pure Uniswap-v4 / Argus math — pool identity, price, side classification and
 * the hook's tax schedule. No RPC, no state; unit-tested. All swap *execution*
 * (exact amounts, slippage) goes through UniversalRouter, not this file — these
 * are for identity and display/quote estimation.
 */

/** COMBINED_RATE_CAP_BPS from the LaunchHook: leg tax + snipe is capped at 99%. */
export const COMBINED_RATE_CAP_BPS = 9_900;
/** Pool fee in bps (10000 v4 units = 1% = 100 bps). */
export const POOL_FEE_BPS = ARGUS_POOL_FEE / 100;

/** Numeric currency ordering, exactly as v4 sorts a PoolKey. */
export function orderCurrencies(
  tokenA: string,
  tokenB: string,
): { currency0: string; currency1: string; tokenIsToken0: boolean } {
  const a = getAddress(tokenA);
  const b = getAddress(tokenB);
  const aFirst = BigInt(a) < BigInt(b);
  return {
    currency0: aFirst ? a : b,
    currency1: aFirst ? b : a,
    tokenIsToken0: aFirst, // when tokenA is the launch token, this is tokenIsToken0
  };
}

/**
 * poolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks)).
 * Full ABI encoding (NOT encodePacked, NOT sha3-256) — per Argus integrate docs.
 * The hook is part of the key, so the id cannot come from the token pair alone.
 */
export function computePoolId(
  currency0: string,
  currency1: string,
  hooks: string,
  fee: number = ARGUS_POOL_FEE,
  tickSpacing: number = ARGUS_TICK_SPACING,
): string {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint24", "int24", "address"],
    [getAddress(currency0), getAddress(currency1), fee, tickSpacing, getAddress(hooks)],
  );
  return keccak256(encoded);
}

/**
 * Human quote-per-token price from a pool's sqrtPriceX96.
 *   r = (sqrtPriceX96 / 2^96)^2   = raw currency1 per raw currency0
 *   quote/token = r if the launch token is currency0, else 1/r
 *   × 10^(tokenDecimals - quoteDecimals) for human units
 * Float math — fine for display/estimation; exact execution uses the router.
 */
export function priceFromSqrtX96(
  sqrtPriceX96: bigint,
  tokenIsToken0: boolean,
  tokenDecimals: number,
  quoteDecimals: number,
): number {
  if (sqrtPriceX96 <= 0n) return 0;
  const sqrtP = Number(sqrtPriceX96) / 2 ** 96;
  const r = sqrtP * sqrtP; // currency1 per currency0
  const quotePerToken = tokenIsToken0 ? r : 1 / r;
  return quotePerToken * 10 ** (tokenDecimals - quoteDecimals);
}

/**
 * v4 swap direction for a trade against a launch pool. `zeroForOne` swaps
 * currency0→currency1. Buying the launch token means spending the quote asset to
 * receive the token; selling is the reverse.
 */
export function swapDirection(
  side: "buy" | "sell",
  tokenIsToken0: boolean,
): { zeroForOne: boolean } {
  // token is currency0 → buying it is quote(currency1)→token(currency0) = !zeroForOne.
  // token is currency1 → buying it is quote(currency0)→token(currency1) =  zeroForOne.
  const zeroForOne = side === "buy" ? !tokenIsToken0 : tokenIsToken0;
  return { zeroForOne };
}

/**
 * Total cost on the quote leg for one trade, in bps: the AMM pool fee plus the
 * hook's combined (leg tax + snipe) which is itself capped at 99%. Read
 * `legTaxBps` and `snipeBps` from the launch's own hook; do not add displayed
 * percentages and call it execution — simulate for the real number.
 */
export function effectiveCostBps(legTaxBps: number, snipeBps: number): number {
  const combined = Math.min(legTaxBps + snipeBps, COMBINED_RATE_CAP_BPS);
  return POOL_FEE_BPS + combined;
}

/** The 3-second opening surcharge makes trades ruinous at t≈0. A UI must guard
 *  it: block/warn while snipe tax is above this floor. */
export const SNIPE_GUARD_BPS = 300; // 3% — refuse to auto-execute above this
export const isSnipeWindow = (snipeBps: number): boolean => snipeBps > SNIPE_GUARD_BPS;
