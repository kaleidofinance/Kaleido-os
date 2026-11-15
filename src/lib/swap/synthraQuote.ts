export interface SynthraQuoteIdentity {
  user: string;
  sourceChainId: number;
  destinationChainId: number;
  tokenIn: { address: string; decimals: number };
  tokenOut: { address: string; decimals: number };
  amount: string;
  slippageBps: number;
}

export interface SynthraValidatedQuote {
  quoteId: string;
  expiresAt: number;
  /** Present for external execution and used to poll settlement status. */
  executionRequestId?: string;
  chosen?: "internal" | "external" | string;
  amountOut: string;
  minimumAmountOut: string;
  /** Provider steps are untrusted data; validation here does not authorize signing. */
  steps: unknown[];
}

/** Validate quote identity and bounds before using it in route comparisons. */
export function validateSynthraQuote(
  raw: unknown,
  expected: SynthraQuoteIdentity,
  now = Date.now(),
): SynthraValidatedQuote | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const q = r.quote;
  const req = r.request;
  const equalAddress = (a: unknown, b: string) =>
    typeof a === "string" && a.toLowerCase() === b.toLowerCase();
  const integer = (a: unknown): a is string =>
    typeof a === "string" && /^\d+$/.test(a);
  const requestId = q?.executionRequestId ?? r.executionRequestId;
  const validRequestId =
    requestId === undefined ||
    (typeof requestId === "string" &&
      /^[A-Za-z0-9._:-]{8,256}$/.test(requestId));
  if (
    r.state !== "Success" ||
    q?.state !== "Success" ||
    typeof r.quoteId !== "string" ||
    !r.quoteId ||
    !Number.isSafeInteger(r.expiresAt) ||
    r.expiresAt <= now ||
    !req ||
    !equalAddress(req.user, expected.user) ||
    !equalAddress(req.recipient, expected.user) ||
    req.sourceChainId !== expected.sourceChainId ||
    req.destinationChainId !== expected.destinationChainId ||
    q.sourceChainId !== expected.sourceChainId ||
    q.destinationChainId !== expected.destinationChainId ||
    !equalAddress(req.tokenIn?.address, expected.tokenIn.address) ||
    !equalAddress(req.tokenOut?.address, expected.tokenOut.address) ||
    req.tokenIn?.decimals !== expected.tokenIn.decimals ||
    req.tokenOut?.decimals !== expected.tokenOut.decimals ||
    req.amount !== expected.amount ||
    req.tradeType !== "EXACT_INPUT" ||
    req.slippageBps !== expected.slippageBps ||
    q.amountIn !== expected.amount ||
    !integer(q.amountOut) ||
    !integer(q.minimumAmountOut) ||
    BigInt(q.minimumAmountOut) <= 0n ||
    BigInt(q.minimumAmountOut) > BigInt(q.amountOut) ||
    !Array.isArray(q.steps) ||
    q.steps.length === 0 ||
    !validRequestId
  )
    return null;
  if (
    !Number.isInteger(expected.slippageBps) ||
    expected.slippageBps < 0 ||
    expected.slippageBps > 5000 ||
    BigInt(q.minimumAmountOut) <
      (BigInt(q.amountOut) * BigInt(10000 - expected.slippageBps)) / 10000n
  )
    return null;
  // A malformed maximum must never be treated as an exact-input quote.
  if (
    !integer(q.maximumAmountIn) ||
    BigInt(q.maximumAmountIn) !== BigInt(expected.amount)
  )
    return null;
  return {
    quoteId: r.quoteId,
    expiresAt: r.expiresAt,
    ...(typeof requestId === "string" ? { executionRequestId: requestId } : {}),
    ...(typeof r.chosen === "string" ? { chosen: r.chosen } : {}),
    amountOut: q.amountOut,
    minimumAmountOut: q.minimumAmountOut,
    steps: q.steps,
  };
}
