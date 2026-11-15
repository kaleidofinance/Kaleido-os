import assert from "node:assert/strict";

process.env.SYNTHRA_API_KEY = "test-key";

const user = "0x1111111111111111111111111111111111111111";
const tokenIn = "0x2222222222222222222222222222222222222222";
const tokenOut = "0x3333333333333333333333333333333333333333";
const executor = "0x8f419898da502d3f49ef379775507210de2bfe3a";
const amount = "1000000";

const response = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;

const quote = {
  state: "Success",
  quoteId: "tq_elysium_executor_test",
  expiresAt: Date.now() + 60_000,
  chosen: "external",
  request: {
    user,
    recipient: user,
    sourceChainId: 99901,
    destinationChainId: 99901,
    tokenIn: { address: tokenIn, decimals: 6 },
    tokenOut: { address: tokenOut, decimals: 18 },
    amount,
    tradeType: "EXACT_INPUT",
    slippageBps: 50,
  },
  quote: {
    source: "external",
    state: "Success",
    sourceChainId: 99901,
    destinationChainId: 99901,
    amountIn: amount,
    maximumAmountIn: amount,
    amountOut: "2000000000000000000",
    minimumAmountOut: "1990000000000000000",
    steps: [
      {
        kind: "transaction",
        items: [
          {
            kind: "transaction",
            data: {
              from: user,
              to: executor,
              data: "0x1234",
              value: "0",
              chainId: 99901,
            },
          },
        ],
      },
    ],
  },
};

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/v1/chains"))
    return response({ chains: [{ chainId: 99901 }] });
  if (url.endsWith("/v1/swap/quote")) return response(quote);
  if (url.endsWith("/v1/swap"))
    return response({
      amountIn: amount,
      amountOut: "2000000000000000000",
      transaction: {
        from: user,
        to: executor,
        data: "0x1234",
        value: "0",
        chainId: 99901,
      },
    });
  throw new Error(`unexpected URL: ${url} ${init?.method ?? ""}`);
}) as typeof fetch;

void (async () => {
  const { inspectSynthraInternalSwap } = await import("./synthraServer");
  const result = await inspectSynthraInternalSwap({
    user,
    sourceChainId: 99901,
    destinationChainId: 99901,
    tokenIn: { address: tokenIn, decimals: 6 },
    tokenOut: { address: tokenOut, decimals: 18 },
    amount,
    slippageBps: 50,
  });

  assert.equal(result?.to.toLowerCase(), executor);
  assert.equal(result?.minimumOut, "1990000000000000000");
  globalThis.fetch = originalFetch;
  console.log("Synthra Elysium executor inspection passed");
})().catch((error) => {
  globalThis.fetch = originalFetch;
  throw error;
});
