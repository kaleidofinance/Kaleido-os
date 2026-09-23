import { argusEnabled } from "./addresses";
import {
  swapDirection,
  effectiveCostBps,
  isSnipeWindow,
  COMBINED_RATE_CAP_BPS,
  POOL_FEE_BPS,
} from "./poolMath";
import type { ArgusLaunch, ArgusPoolState } from "./launch";

/**
 * Tax-aware quote for a buy/sell against an Argus launch pool.
 *
 * Argus puts the WHOLE supply in one Uniswap-v4 concentrated position
 * (tickStart→tickBond), so a swap is a single-range move and the exact
 * within-range v4 math (identical to v3 SqrtPriceMath) applies. We compute in
 * floating point in raw units: for a quote that's ~1e-15 relative error, and the
 * real min-out/slippage is enforced on-chain by the swap (Phase 3), so this is an
 * accurate ESTIMATE, deliberately not a wei-exact contract replica.
 *
 * Costs modelled, in order the chain applies them:
 *  - the hook's tax (leg + snipe, capped 99%) on the QUOTE leg — withheld from
 *    quote-in on a buy, from quote-out on a sell;
 *  - the 1% pool fee on the AMM input;
 *  - AMM price impact from moving sqrtP within the position.
 *
 * Flags `exhaustsRange` when the trade would push price past the single
 * position's bounds (the estimate then over-states fill — defer to the router),
 * and `snipeBlocked` inside the ~3s opening surcharge (never auto-execute there).
 */

export interface ArgusQuote {
  side: "buy" | "sell";
  /** Human units of the input asset (quote for buy, token for sell). */
  amountIn: number;
  /** Human units of the output asset (token for buy, quote for sell). */
  amountOut: number;
  /** Quote-asset per token, from current pool price. */
  spotPrice: number;
  /** All-in effective price the user pays/receives (incl. fee+tax+impact). */
  effectivePrice: number;
  /** Pure AMM price move from this trade, in bps. */
  priceImpactBps: number;
  poolFeeBps: number;
  taxBps: number;
  snipeBps: number;
  /** pool fee + capped(leg tax + snipe). */
  totalCostBps: number;
  snipeBlocked: boolean;
  exhaustsRange: boolean;
  estimate: true;
}

const sqrtRatioAtTick = (tick: number): number => Math.sqrt(1.0001 ** tick);

/**
 * @param amountInRaw input amount in the input asset's smallest units
 *   (quote units for a buy, token units for a sell)
 * @param tokenDecimals / quoteDecimals decimals of the launch token / quote asset
 */
export function quoteArgusSwap(params: {
  launch: ArgusLaunch;
  state: ArgusPoolState;
  side: "buy" | "sell";
  amountInRaw: bigint;
  tokenDecimals: number;
  quoteDecimals: number;
}): ArgusQuote | null {
  if (!argusEnabled()) return null;
  const { launch, state, side, amountInRaw, tokenDecimals, quoteDecimals } = params;
  if (amountInRaw <= 0n || state.sqrtPriceX96 <= 0n || state.liquidity <= 0n) return null;

  const { zeroForOne } = swapDirection(side, launch.tokenIsToken0);
  const legTaxBps = side === "buy" ? launch.buyTaxBps : launch.sellTaxBps;
  const snipeBps = state.snipeBps;
  const combinedTaxBps = Math.min(legTaxBps + snipeBps, COMBINED_RATE_CAP_BPS);
  const totalCostBps = effectiveCostBps(legTaxBps, snipeBps);

  // Raw floating amounts. Number precision (~2e-16 relative) is negligible for a quote.
  const sqrtP = Number(state.sqrtPriceX96) / 2 ** 96; // sqrt(raw c1/c0)
  const L = Number(state.liquidity);
  const feeFrac = POOL_FEE_BPS / 10_000; // 0.01
  const taxFrac = combinedTaxBps / 10_000;
  const amountIn = Number(amountInRaw);

  // Tax on the quote leg: buy withholds from quote-in (before the AMM); sell
  // withholds from quote-out (after the AMM).
  const ammInRaw = side === "buy" ? amountIn * (1 - taxFrac) : amountIn;
  const ammInLessFee = ammInRaw * (1 - feeFrac);

  // Single-range swap: input drives sqrtP, output is the opposite leg.
  let sqrtPNext: number;
  let ammOutRaw: number;
  if (zeroForOne) {
    // currency0 in, price falls: sqrtP' = L*sqrtP / (L + dx*sqrtP); out = L*(sqrtP - sqrtP')
    sqrtPNext = (L * sqrtP) / (L + ammInLessFee * sqrtP);
    ammOutRaw = L * (sqrtP - sqrtPNext);
  } else {
    // currency1 in, price rises: sqrtP' = sqrtP + dy/L; out = L*(1/sqrtP - 1/sqrtP')
    sqrtPNext = sqrtP + ammInLessFee / L;
    ammOutRaw = L * (1 / sqrtP - 1 / sqrtPNext);
  }

  // The whole supply is one position [tickStart, tickBond]; flag if we'd leave it.
  const sqrtLo = sqrtRatioAtTick(Math.min(launch.tickStart, launch.tickBond));
  const sqrtHi = sqrtRatioAtTick(Math.max(launch.tickStart, launch.tickBond));
  const exhaustsRange = sqrtPNext < sqrtLo || sqrtPNext > sqrtHi;

  // Sell: tax is withheld from the quote output.
  const outRaw = side === "sell" ? ammOutRaw * (1 - taxFrac) : ammOutRaw;
  if (!(outRaw > 0)) return null;

  const outDecimals = side === "buy" ? tokenDecimals : quoteDecimals;
  const inDecimals = side === "buy" ? quoteDecimals : tokenDecimals;
  const amountOut = outRaw / 10 ** outDecimals;
  const amountInHuman = amountIn / 10 ** inDecimals;

  // Prices in quote-per-token. Spot from current sqrtP (scaled to human), effective
  // from what the user actually gets in/out.
  const rawR = sqrtP * sqrtP; // raw c1 per raw c0
  const rawQuotePerToken = launch.tokenIsToken0 ? rawR : 1 / rawR;
  const spotPrice = rawQuotePerToken * 10 ** (tokenDecimals - quoteDecimals);
  const tokenHuman = side === "buy" ? amountOut : amountInHuman;
  const quoteHuman = side === "buy" ? amountInHuman : amountOut;
  const effectivePrice = tokenHuman > 0 ? quoteHuman / tokenHuman : 0;

  const priceImpactBps = Math.round(
    Math.abs((sqrtPNext * sqrtPNext - rawR) / rawR) * 10_000,
  );

  return {
    side,
    amountIn: amountInHuman,
    amountOut,
    spotPrice,
    effectivePrice,
    priceImpactBps,
    poolFeeBps: POOL_FEE_BPS,
    taxBps: legTaxBps,
    snipeBps,
    totalCostBps,
    snipeBlocked: isSnipeWindow(snipeBps),
    exhaustsRange,
    estimate: true,
  };
}
