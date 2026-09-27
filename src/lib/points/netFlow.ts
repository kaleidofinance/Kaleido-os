/**
 * Round-trip netting for swap points — pure, so every rule is tested without a
 * chain or a database.
 *
 * Why: swap points paid on gross volume, so a round trip (USDC→EURC, then
 * EURC→USDC a minute later) earned on BOTH legs while leaving the wallet where it
 * started. Measured 2026-09-27: 52 of 133 credited swaps looked like return legs,
 * and one wallet turned ~$1 of fees into ~10,000 points with a $260 round trip.
 *
 * The rule: per wallet, per UTC day, per PAIR of assets, keep the running net flow
 * in one direction (A→B positive, B→A negative). A swap earns points only on the
 * amount by which it pushes that day's largest absolute net flow past its
 * previous high. So:
 *   A→B $100            → net +100, high 0→100   → earns on $100
 *   B→A $99 (return)    → net +1,   high stays   → earns on $0
 *   A→B $100 (again)    → net +101, high 100→101 → earns on $1
 *   A→B $100, A→B $100  → net +200, high 200     → both earn (a real buyer)
 *   A→B $100, B→A $300  → net -200, high 100→200 → earns on $100 (net seller)
 * Forward-only by construction: it decides the swap being credited and never
 * revisits a swap already paid.
 *
 * Known limit, accepted: a CYCLE through three different pairs (A→B, B→C, C→A)
 * nets on no single pair, so it is not caught here. It costs three fees for three
 * legs and is still bounded by the source's daily points cap.
 */

/** The dollar assets on Arc, folded into one key so a round trip that returns via
 *  a different dollar (the 0x3600 ERC-20 face vs our wrapped-native) still nets. */
export const USD_ASSET = "usd";

/**
 * The address Arc logs NATIVE USDC movements under. Every native move is logged
 * twice in the same receipt: an ERC-20 Transfer from this address (18 decimals,
 * the native unit) and one from the 0x3600 face (6 decimals). It has no code; it
 * is a log source only. Measured 2026-09-27 on the first live swaps after #459:
 * a wallet's USD→EURC leg recorded its input as this address while the EURC→USD
 * return recorded "usd", so the two sat on different pairs and did not net.
 * It must be in every dollar list passed to assetKey / swapAssets.
 */
export const ARC_NATIVE_USDC_LOG = "0xfffffffffffffffffffffffffffffffffffffffe";

export interface SwapLeg {
  /** Asset the wallet gave up (lowercased address, or USD_ASSET). */
  assetIn: string;
  /** Asset the wallet received. */
  assetOut: string;
  /** Dollar size of the swap. */
  usd: number;
}

/** A token address → its netting key: USD_ASSET for any dollar, else the
 *  lowercased address. */
export function assetKey(token: string, usdTokens: readonly string[]): string {
  const t = token.toLowerCase();
  return usdTokens.some((u) => u.toLowerCase() === t) ? USD_ASSET : t;
}

/**
 * Which asset the wallet gave up and which it received in one swap, from the
 * transaction's ERC-20 transfers. `inputToken` is the leg the collector already
 * identified as the wallet's own. The output is a token that arrived AT the
 * wallet and differs from the input.
 *
 * When no output transfer is found the output is native USDC, which moves without
 * an ERC-20 log: USD if the input was not already a dollar. A dollar-in trade with
 * no visible output cannot be classified, so it returns null and the caller
 * credits it on its full size, exactly as before this rule existed.
 */
export function swapAssets(args: {
  wallet: string;
  inputToken: string;
  transfers: readonly { token: string; from: string; to: string; value: bigint }[];
  usdTokens: readonly string[];
}): { assetIn: string; assetOut: string } | null {
  const w = args.wallet.toLowerCase();
  const assetIn = assetKey(args.inputToken, args.usdTokens);
  let assetOut: string | null = null;
  for (const t of args.transfers) {
    if (t.to !== w || t.value <= 0n) continue;
    const k = assetKey(t.token, args.usdTokens);
    if (k !== assetIn) assetOut = k; // last distinct arrival wins
  }
  if (assetOut === null) {
    if (assetIn === USD_ASSET) return null;
    assetOut = USD_ASSET;
  }
  return { assetIn, assetOut };
}

/** A leg's direction on its pair: +1 when it runs from the lower key to the
 *  higher one, -1 the other way. Both legs of a round trip get opposite signs. */
function direction(leg: SwapLeg): 1 | -1 {
  return leg.assetIn < leg.assetOut ? 1 : -1;
}

function samePair(a: SwapLeg, b: SwapLeg): boolean {
  return (
    (a.assetIn === b.assetIn && a.assetOut === b.assetOut) ||
    (a.assetIn === b.assetOut && a.assetOut === b.assetIn)
  );
}

/**
 * How many of `current.usd` dollars earn points, given the wallet's earlier legs
 * the same day (in the order they happened). Never negative, never more than the
 * swap's own size.
 */
export function netCreditableUsd(
  prior: readonly SwapLeg[],
  current: SwapLeg,
): number {
  if (!(current.usd > 0) || current.assetIn === current.assetOut) return 0;
  let net = 0;
  let high = 0;
  for (const leg of prior) {
    if (!samePair(leg, current) || !(leg.usd > 0)) continue;
    net += direction(leg) * leg.usd;
    high = Math.max(high, Math.abs(net));
  }
  const after = net + direction(current) * current.usd;
  const creditable = Math.max(0, Math.abs(after) - high);
  return Math.min(creditable, current.usd);
}
