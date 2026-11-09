import assert from "node:assert/strict";
import { runAgent } from "./agent";
import { createTurnContext } from "./turnContext";
import type { ChatProvider } from "./types";

let calls = 0;
let secondPrompt = "";
const provider: ChatProvider = {
  id: "scope-test",
  model: "scope-test-model",
  async chat(input) {
    calls++;
    if (calls === 1) {
      return {
        text: "Checking the selected network.",
        reads: [{ name: "getIntegrations", args: {} }],
        executes: [],
        provider: "scope-test",
        model: "scope-test-model",
      };
    }
    secondPrompt = input.messages.at(-1)?.content ?? "";
    return {
      text: "The selected network has no registered integration adapters.",
      reads: [],
      executes: [],
      provider: "scope-test",
      model: "scope-test-model",
    };
  },
};

(async () => {
  const context = createTurnContext({
    chainId: 99801,
    showTestnets: true,
    address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
  });

  const run = await runAgent(provider, {
    message: "which integrations are on this chain?",
    // Deliberately conflicting legacy fields: the validated context must win.
    chainId: 5042,
    networkMode: "mainnet",
    mainnetOnly: true,
    context,
  });

  assert.equal(calls, 2);
  assert.equal(run.trace[0]?.name, "getIntegrations");
  assert.match(secondPrompt, /Elysium Testnet/);
  assert.match(secondPrompt, /networkMode.*testnet/i);
  assert.doesNotMatch(secondPrompt, /Argus launchpad adapter/);

  console.log("Agent scope checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
