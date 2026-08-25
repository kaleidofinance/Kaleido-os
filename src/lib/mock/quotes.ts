import { chainTokenByAddress } from "@/constants/tokens";

/**
 * What a swap would return.
 *
 * `useV3SwapRouter`'s two quote functions ask the on-chain quoter, which needs a
 * deployed quoter and a pool with liquidity. Without either, both return "0", and
 * the swap card treats "0" as "no quote" and blanks the output field — so /trade,
 * /trade/swap, /trade/buy and /trade/sell all render a card you can type into and
 * get nothing back from. This is the table that fills that in: it prices the legs
 * and applies the pool fee, which is enough for an output amount, a rate row and
 * a min-received figure.
 *
 * THESE ARE POOL RATIOS, NOT ORACLE PRICES, and the distinction is the reason
 * this file can price KLD while ./pools calls it unpriced and
 * `MarketOverview.kldStaked` stays denominated in KLD. A pool always knows the
 * ratio of its own two reserves — that is what a swap executes against — while an
 * oracle price is a claim about what one leg is worth in dollars, which nobody
 * can make about KLD before it trades. Quoting a KLD swap is honest; valuing a
 * KLD balance in dollars is not.
 *
 * THE RATIOS ARE ./pools' OWN ASSUMPTIONS, so the two fixtures cannot disagree
 * about what a KLD is worth between the pool table and the swap card. Where
 * ./pools is silent — the three chain-native assets below — this file introduces
 * a figure, and says so.
 *
 * WHAT IS DELIBERATELY MISSING:
 *
 *   - Price impact. A ratio table has no depth, so every size quotes at mid.
 *     The real quoter walks ticks and a large order comes back worse; here it
 *     does not. The swap card renders no impact row, so nothing on screen claims
 *     otherwise.
 *   - Pool existence. Any two priced symbols quote against each other, which is
 *     more liquidity than ./pools describes (there is no DAI/WBTC pool there).
 *     Gating on MOCK_POOLS is not the fix: those pools carry fixture addresses,
 *     and the swap card passes registry addresses, so every real pair would
 *     resolve to no pool and quote "0" — the exact state this seam exists to
 *     clear.
 *
 * WHAT IS DELIBERATELY PRESENT: the two ways the real path returns "0" — an
 * unpriced leg (the quoter reverts, the catch returns "0") and an `amountIn` with
 * more decimals than the token has (`parseUnits` throws before any call is made).
 * A fixture that quoted where the real thing cannot would hide the blank-output
 * behaviour rather than demonstrate it.
 *
 * Nothing here touches `swapV3` or `swapV3MultiHop`. Those build calldata and
 * hand it to a signer, and they stay on the real router.
 */

/** ./pools pool 2: 3,100,000 KLD against 643,000 USDC. */
const KLD_USD = 0.20741935483870968;

/**
 * ./pools pool 7 prices 1 KLD at 0.98122 stKLD, so a stKLD is worth slightly
 * more than a KLD — which is the whole mechanism, since stKLD accrues yield as
 * the share price rises rather than by paying out.
 */
const STKLD_USD = KLD_USD / 0.9812195121951219;

/**
 * USD per whole token.
 *
 * WETH, WBTC and the dollar assets are ./pools' stated assumptions verbatim.
 * cbBTC and BTCB are the same asset as WBTC on two other chains. USDe is a
 * dollar because ./stable holds it as dollar collateral.
 *
 * BNB, POL and HYPE appear in no pool in ./pools, so these three are new
 * assumptions introduced here — at plausible spot, for the sole purpose of
 * letting the swap card quote a native leg on BNB Chain, Polygon and Hyperliquid
 * instead of blanking.
 *
 * Exported because ./market values the lending book against it, so the swap card
 * and the "Open book" tile cannot disagree about what an ether is worth. That
 * reads these as oracle prices, which the header above says they are not — sound
 * for the five lending currencies only, because no pool in ./pools trades away
 * from the price it was built from, so ratio and oracle coincide. KLD is the
 * asset where the distinction bites, and KLD is not a lending currency.
 */
export const MOCK_USD: Record<string, number> = {
  ETH: 3400,
  WETH: 3400,

  WBTC: 62_000,
  cbBTC: 62_000,
  BTCB: 62_000,

  USDC: 1,
  USDT: 1,
  USDe: 1,
  DAI: 1,
  kfUSD: 1,
  kafUSD: 1,

  KLD: KLD_USD,
  stKLD: STKLD_USD,

  BNB: 640,
  WBNB: 640,
  tBNB: 640,
  POL: 0.42,
  WPOL: 0.42,
  HYPE: 38,
};

/**
 * Price for one address on one chain.
 *
 * Resolved through `chainTokenByAddress` rather than a symbol the caller passed,
 * because the caller passes an address and the two native sentinels mean a
 * different asset on every chain: 0xEeee… is ETH on Ethereum, BNB on BNB Chain
 * and 18-decimal USDC on Arc. That is registry.ts's rule 1, and it is why the
 * quote seam needs a chain id at all.
 */
function priceOf(chainId: number | undefined, address: string): number | null {
  const symbol = chainTokenByAddress(chainId, address)?.symbol;
  if (!symbol) return null;
  return MOCK_USD[symbol] ?? null;
}

/** Decimals actually written in an amount, for the `parseUnits` guard. */
function decimalPlaces(amount: string): number {
  const dot = amount.indexOf(".");
  return dot === -1 ? 0 : amount.length - dot - 1;
}

/**
 * `formatUnits`-shaped output.
 *
 * Round values keep one decimal place ("1200.0"), which is the shape the real
 * function returns and the shape the swap card's `String(out)` renders. Capped at
 * 8 places rather than the token's full 18: past ~15 significant digits a double
 * is inventing figures, and the real quoter's trailing digits come from integer
 * maths this cannot reproduce.
 */
function formatLike(value: number, decimals: number): string {
  const fixed = value.toFixed(Math.min(decimals, 8));
  if (!fixed.includes(".")) return fixed;
  const trimmed = fixed.replace(/0+$/, "");
  return trimmed.endsWith(".") ? `${trimmed}0` : trimmed;
}

/**
 * A single-hop quote, net of the pool fee.
 *
 * `fee` is hundredths of a bip, as the V3 pool declares it — 3000 is 0.30%.
 */
export function mockQuote(
  chainId: number | undefined,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  fee: number,
  decimalsIn: number,
  decimalsOut: number,
): string {
  const amount = Number(amountIn);
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  if (decimalPlaces(amountIn) > decimalsIn) return "0";

  const priceIn = priceOf(chainId, tokenIn);
  const priceOut = priceOf(chainId, tokenOut);
  if (priceIn === null || priceOut === null) return "0";

  const out = ((amount * priceIn) / priceOut) * (1 - fee / 1_000_000);
  return formatLike(out, decimalsOut);
}

/**
 * A multi-hop quote.
 *
 * Every token on the path must be priced, not just the ends: the real
 * `quoteExactInput` needs a pool for each hop and reverts if any is missing, so a
 * route through an unpriced middle leg must return "0" here too. Each hop's fee
 * compounds, which is the reason a two-hop route quotes worse than a direct one
 * even at identical prices.
 */
export function mockQuoteMultiHop(
  chainId: number | undefined,
  path: string[],
  fees: number[],
  amountIn: string,
  decimalsIn: number,
  decimalsOut: number,
): string {
  /* The same shape check `encodePath` makes before it will encode anything. */
  if (path.length !== fees.length + 1) return "0";

  const amount = Number(amountIn);
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  if (decimalPlaces(amountIn) > decimalsIn) return "0";

  const prices = path.map((token) => priceOf(chainId, token));
  if (prices.some((p) => p === null)) return "0";

  const first = prices[0] as number;
  const last = prices[prices.length - 1] as number;
  const afterFees = fees.reduce((acc, f) => acc * (1 - f / 1_000_000), 1);

  return formatLike(((amount * first) / last) * afterFees, decimalsOut);
}
