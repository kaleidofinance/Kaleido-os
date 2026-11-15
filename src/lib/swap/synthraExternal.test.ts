import assert from "node:assert/strict";

process.env.SYNTHRA_API_KEY = "test-key";

const user = "0x1111111111111111111111111111111111111111";
const source = 4663;
const destination = 999;
const amount = "10000000000000000";
const txTo = "0x4444444444444444444444444444444444444444";

const response = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;

const quote = {
  state: "Success",
  quoteId: "tq_external_test",
  expiresAt: Date.now() + 60_000,
  chosen: "external",
  request: {
    user,
    recipient: user,
    sourceChainId: source,
    destinationChainId: destination,
    tokenIn: {
      address: "0x0000000000000000000000000000000000000000",
      decimals: 18,
    },
    tokenOut: {
      address: "0x0000000000000000000000000000000000000000",
      decimals: 18,
    },
    amount,
    tradeType: "EXACT_INPUT",
    slippageBps: 50,
  },
  quote: {
    source: "external",
    state: "Success",
    sourceChainId: source,
    destinationChainId: destination,
    amountIn: amount,
    maximumAmountIn: amount,
    amountOut: amount,
    minimumAmountOut: "9950000000000000",
    executionRequestId: "0x1234567890abcdef",
    steps: [
      {
        kind: "transaction",
        items: [
          {
            kind: "transaction",
            data: {
              from: user,
              to: txTo,
              data: "0x1234",
              value: amount,
              chainId: source,
            },
          },
        ],
      },
    ],
  },
};

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/v1/chains"))
    return response({
      chains: [{ chainId: source }, { chainId: destination }],
    });
  if (url.endsWith("/v1/swap/quote")) return response(quote);
  throw new Error(`unexpected URL: ${url}`);
}) as typeof fetch;

void (async () => {
  const { inspectSynthraExternalSwap } = await import("./synthraServer");
  const result = await inspectSynthraExternalSwap({
    user,
    sourceChainId: source,
    destinationChainId: destination,
    tokenIn: {
      address: "0x0000000000000000000000000000000000000000",
      decimals: 18,
    },
    tokenOut: {
      address: "0x0000000000000000000000000000000000000000",
      decimals: 18,
    },
    amount,
    slippageBps: 50,
  });

  assert.equal(result?.transaction.to, txTo);
  assert.equal(result?.executionRequestId, "0x1234567890abcdef");

  globalThis.fetch = originalFetch;
  console.log("Synthra external inspection passed");
})().catch((error) => {
  globalThis.fetch = originalFetch;
  throw error;
});
