import assert from "node:assert/strict";
import { parseCommand } from "../v2/intents/fromCommand.ts";
import {
  isDirectInstruction,
  isDirectFollowUp,
  isSlotReply,
  isStableExplanation,
} from "./turnPolicy.ts";

for (const text of [
  "can I borrow against BNB?",
  "is it a good time to swap?",
  "explain how I can lend",
  "I think we should bridge later",
  "what is the best network to trade on?",
  "how much revenue does Kaleido have?",
  "should I swap 100 USDC to EURC?",
]) {
  const result = isDirectInstruction(text)
    ? parseCommand(text, [])
    : { status: "unknown" };
  assert.equal(result.status, "unknown", text);
  assert.equal(isStableExplanation(text), false, text);
}
for (const text of [
  "swap 100 USDC to EURC",
  "please bridge 50 USDC to BSC",
  "can you swap 10 USDC to USDT",
  "lend",
  "move everything off Abstract to Arc",
  "show my balances on BSC",
])
  assert.equal(isDirectInstruction(text), true, text);
assert.equal(isStableExplanation("what is slippage?"), true);
assert.equal(
  isStableExplanation("what is slippage on my current trade?"),
  false,
);
assert.equal(isStableExplanation("which chains are live?"), false);
assert.equal(isDirectFollowUp("do that again"), true);
assert.equal(isDirectFollowUp("why did you do that?"), false);
assert.equal(
  isSlotReply("USDC", (v) => v === "USDC"),
  true,
);
assert.equal(
  isSlotReply("30 days", () => false),
  true,
);
assert.equal(
  isSlotReply("what can I borrow?", () => false),
  false,
);
console.log(
  "Turn routing: conversational, live-data, command and slot regressions passed",
);
