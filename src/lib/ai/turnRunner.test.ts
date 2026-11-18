import assert from "node:assert/strict";
import { getCapabilitySnapshot } from "./capabilities";
import { filterToolsForTurn, TOOL_CATALOG } from "./toolCatalog";
import { runTurn, settleAgentTurn } from "./turnRunner";
import type { ChatProvider } from "./types";

const provider: ChatProvider = {
  id: "turn-runner-test",
  model: "turn-runner-test",
  async chat() {
    return {
      text: "Ready.",
      reads: [],
      executes: [],
      provider: "turn-runner-test",
      model: "turn-runner-test",
    };
  },
};

(async () => {
  const result = await runTurn({
    providers: [provider],
    input: { message: "hello" },
  });
  assert.equal(result.text, "Ready.");
  assert.equal(result.rounds, 0);
  await assert.rejects(
    () => runTurn({ providers: [], input: { message: "hello" } }),
    /No model provider configured/,
  );

  // Capability filtering: Robinhood mainnet has no lending/staking/stablecoin/faucet.
  const robinhoodCaps = getCapabilitySnapshot({ chainId: 4663, networkMode: "mainnet" });
  const filtered = filterToolsForTurn(robinhoodCaps);
  assert.ok(filtered.length < TOOL_CATALOG.length);
  assert.equal(filtered.some((t) => t.name === "claimTestTokens"), false);
  assert.equal(filtered.some((t) => t.name === "stake"), false);
  assert.equal(filtered.some((t) => t.name === "swap"), true);

  const readOnly = filterToolsForTurn(robinhoodCaps, { readOnly: true });
  assert.equal(readOnly.some((t) => t.kind === "execute"), false);

  // settleAgentTurn discloses fallback and sets canonical TurnResult outcome.
  const settled = await settleAgentTurn({
    result: { ...result, provider: "fallback-id", model: "fallback-model" },
    chainId: 4663,
    userText: "hi",
    safeLimits: { slippageBps: 50 },
    primaryProvider: provider,
    quota: { used: 1, quota: 25, remaining: 24 },
    capabilities: robinhoodCaps,
    startedAt: Date.now(),
    requestId: "req-1",
  });
  assert.equal(settled.outcome.kind, "answer");
  assert.equal(settled.context.failedOver, true);
  assert.match(settled.response, /fallback-model answered this turn/);

  // readOnly mode suppresses execute calls even if the model emitted one.
  const roSettled = await settleAgentTurn({
    result: {
      text: "Here is my research.",
      reads: [],
      executes: [{ name: "swap", args: { amount: "10", tokenIn: "USDC", tokenOut: "WETH" } }],
      provider: "turn-runner-test",
      model: "turn-runner-test",
      trace: [],
      rounds: 0,
    },
    chainId: 4663,
    userText: "research only",
    safeLimits: { slippageBps: 50 },
    primaryProvider: provider,
    readOnly: true,
    quota: { used: 1, quota: 25, remaining: 24 },
    capabilities: robinhoodCaps,
    startedAt: Date.now(),
    requestId: "req-ro",
  });
  assert.equal(roSettled.outcome.kind, "answer");
  assert.deepEqual(roSettled.context.plan, []);

  console.log("Turn runner checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
