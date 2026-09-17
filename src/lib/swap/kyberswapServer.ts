/**
 * Server-only KyberSwap swap-fee configuration — our cut on aggregator swaps.
 *
 * Same shape and reasoning as lib/bridge/lifiServer.ts: read from PLAIN
 * (non-NEXT_PUBLIC) env so the fee receiver and rate never ship in the browser
 * bundle. getKyberSwapExecution runs in the browser too, so the browser reaches
 * KyberSwap through /api/swap/quote, which adds these there.
 *
 * `SWAP_FEE_BPS` — our fee in basis points (default 20 = 0.2%, matching the
 *   bridge fee). Charged on the INPUT token (`chargeFeeBy: "currency_in"`) so the
 *   fee wallet accumulates the stable/known side rather than a bag of memecoins.
 * `SWAP_FEE_RECEIVER` — the address the fee is sent to. UNSET means no fee is
 *   requested at all (KyberSwap still returns a working route), so a missing
 *   receiver degrades to a zero-fee swap rather than a broken one.
 * `KYBERSWAP_CLIENT_ID` — the `x-client-id` KyberSwap attributes volume to;
 *   defaults to "kaleido".
 */

/** Our swap fee in basis points. 20 = 0.2%. */
export function swapFeeBps(): number {
  const raw = Number(process.env.SWAP_FEE_BPS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 20;
}

/** The fee-collection wallet, or undefined when fee collection is off. */
export function swapFeeReceiver(): string | undefined {
  const r = process.env.SWAP_FEE_RECEIVER;
  return r && r.length > 0 ? r : undefined;
}

/** The client id KyberSwap attributes volume to. */
export function kyberClientId(): string {
  return process.env.KYBERSWAP_CLIENT_ID || "kaleido";
}

/**
 * Our fee as KyberSwap `/routes` query params, or an empty object when no
 * receiver is configured. `isInBps` + `chargeFeeBy: "currency_out"` means
 * `feeAmount` is read as basis points of the OUTPUT token.
 *
 * Output, not input — the correctness fix, not a preference. Charging on the
 * INPUT (`currency_in`) makes Arc's KyberSwap router revert every swap with
 * "sender != recipient": its input-side fee mechanism routes the pulled input
 * through the fee receiver, and the router then sees the swap's recipient differ
 * from the caller and reverts — reproduced on-chain, deterministic on the fee
 * side and only there. `currency_out` takes the fee from the output leg instead
 * (a plain transfer of part of the output to `feeReceiver`), which the router
 * accepts. The fee now shows in `amountOut` rather than being hidden on the
 * input, which is the honest number anyway.
 *
 * These go on the ROUTES call, not `/route/build`. KyberSwap computes the fee
 * into the route (it lands in `routeSummary.extraFee` and the built calldata as a
 * transfer to `feeReceiver`); passed to build instead, they are silently ignored
 * and no fee is collected. Values are strings because they ride a query string.
 */
export function kyberFeeParams(): Record<string, string> {
  const receiver = swapFeeReceiver();
  if (!receiver) return {};
  return {
    feeReceiver: receiver,
    chargeFeeBy: "currency_out",
    feeAmount: String(swapFeeBps()),
    isInBps: "true",
  };
}
