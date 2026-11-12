import assert from "node:assert/strict";
import { runAgent } from "./agent";
import type { ChatProvider } from "./types";

let calls = 0;
let lastMessages: Array<{ role: string; content: string }> = [];
const provider: ChatProvider = {
  id: "live-preflight-test",
  model: "live-preflight-test",
  async chat(input) {
    calls += 1;
    lastMessages = input.messages;
    return {
      text: "I checked the live yield sources.",
      reads: [],
      executes: [],
      provider: "live-preflight-test",
      model: "live-preflight-test",
    };
  },
};

(async () => {
  const result = await runAgent(provider, {
    message: "Find yield on Elysium",
    chainId: 99901,
    networkMode: "mainnet",
    analysisMode: "live",
  });
  assert.equal(calls, 1);
  assert.equal(result.trace[0]?.name, "getYieldSources");
  assert.equal(result.trace[0]?.args.targetChain, 99901);
  assert.match(lastMessages.at(-1)?.content ?? "", /Live preflight tool result/i);
  assert.match(lastMessages.at(-1)?.content ?? "", /unsupported/i);

  calls = 0;
  const noRead = await runAgent(provider, {
    message: "Find yield on Elysium",
    chainId: 99901,
    networkMode: "mainnet",
    analysisMode: "live",
    maxReadRounds: 0,
  });
  assert.equal(calls, 1);
  assert.equal(noRead.trace.length, 0);

  const external = await runAgent(provider, {
    message: "Compare external pools and aggregators on BSC",
    chainId: 56,
    networkMode: "mainnet",
    analysisMode: "live",
  });
  assert.equal(external.trace[0]?.name, "getExternalPools");
  assert.match(lastMessages.at(-1)?.content ?? "", /getExternalPools/i);

  const capability = await runAgent(provider, {
    message: "Which launchpads are integrated on Arc?",
    chainId: 5042,
    networkMode: "mainnet",
    analysisMode: "live",
  });
  assert.equal(capability.trace[0]?.name, "getProtocolCapabilities");
  assert.match(lastMessages.at(-1)?.content ?? "", /getProtocolCapabilities/i);

  const analytics = await runAgent(provider, {
    message: "How much revenue has Kaleido made across chains?",
    chainId: 5042,
    networkMode: "mainnet",
    analysisMode: "live",
  });
  assert.equal(analytics.trace[0]?.name, "getAnalytics");
  assert.equal(analytics.trace[0]?.args.scope, "all");

  console.log("Live preflight checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
