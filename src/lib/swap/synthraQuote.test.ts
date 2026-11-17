import assert from "node:assert/strict";
import { validateSynthraQuote } from "./synthraQuote";

const a = "0x1111111111111111111111111111111111111111";
const b = "0x2222222222222222222222222222222222222222";
const input = {
  user: a,
  sourceChainId: 5042,
  destinationChainId: 5042,
  tokenIn: { address: a, decimals: 6 },
  tokenOut: { address: b, decimals: 6 },
  amount: "1000000",
  slippageBps: 50,
};
const valid = {
  state: "Success",
  quoteId: "test",
  expiresAt: 2000,
  request: { ...input, recipient: a, tradeType: "EXACT_INPUT" },
  quote: {
    state: "Success",
    sourceChainId: 5042,
    destinationChainId: 5042,
    amountIn: "1000000",
    maximumAmountIn: "1000000",
    amountOut: "990000",
    minimumAmountOut: "985050",
    steps: [{}],
  },
};
assert.ok(validateSynthraQuote(valid, input, 1000));
assert.equal(validateSynthraQuote(valid, input, 2000), null);
assert.equal(
  validateSynthraQuote(
    { ...valid, request: { ...valid.request, recipient: b } },
    input,
    1000,
  ),
  null,
);
assert.equal(
  validateSynthraQuote(
    { ...valid, quote: { ...valid.quote, minimumAmountOut: "0" } },
    input,
    1000,
  ),
  null,
);
assert.equal(
  validateSynthraQuote(
    { ...valid, quote: { ...valid.quote, sourceChainId: 56 } },
    input,
    1000,
  ),
  null,
);
assert.equal(
  validateSynthraQuote(
    { ...valid, quote: { ...valid.quote, maximumAmountIn: "1000001" } },
    input,
    1000,
  ),
  null,
);
const withExecutionId = {
  ...valid,
  chosen: "external",
  quote: {
    ...valid.quote,
    executionRequestId: "0x1234567890abcdef",
  },
};
assert.equal(
  validateSynthraQuote(withExecutionId, input, 1000)?.executionRequestId,
  "0x1234567890abcdef",
);
assert.equal(
  validateSynthraQuote(
    {
      ...withExecutionId,
      quote: { ...withExecutionId.quote, executionRequestId: "bad id" },
    },
    input,
    1000,
  ),
  null,
);
console.log("Synthra quote validation passed");
