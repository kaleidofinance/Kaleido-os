import assert from "node:assert/strict";
import {
  createAgentInput,
  groundingFromBody,
  historyFromBody,
} from "./turnCoordinator";
import { getCapabilitySnapshot } from "./capabilities";
import { createTurnContext } from "./turnContext";

const context = createTurnContext({
  address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
  chainId: 99801,
  showTestnets: true,
  requestId: "coordinator-test",
});

const capabilities = getCapabilitySnapshot({
  chainId: context.chainId,
  networkMode: context.networkMode,
});

const input = createAgentInput(
  {
    message: "What can I do on Elysium?",
    analysisMode: "live",
    limits: { slippageBps: 99999 },
    localIntent: { kind: "question", reference: "none" },
    history: [
      { role: "user", content: "  older  " },
      { role: "system", content: "should be removed" },
      { role: "assistant", content: "newer" },
    ],
    grounding: [
      {
        title: "Elysium",
        heading: "Networks",
        href: "/docs/networks#elysium",
        text: "Elysium testnet is available for supported surfaces.",
      },
      {
        title: "External",
        heading: "Bad link",
        href: "https://example.com",
        text: "must be rejected",
      },
    ],
  },
  context,
  capabilities,
);

assert.equal(input.context, context);
assert.equal(input.address, context.address);
assert.equal(input.chainId, 99801);
assert.equal(input.networkMode, "testnet");
assert.equal(input.mainnetOnly, false);
assert.equal(input.analysisMode, "live");
assert.equal(input.limits?.slippageBps, 500);
assert.deepEqual(input.history, [
  { role: "user", content: "older" },
  { role: "assistant", content: "newer" },
]);
assert.equal(input.grounding?.length, 1);
assert.match(input.systemAddendum ?? "", /Elysium Testnet/);
assert.match(input.systemAddendum ?? "", /fresh tool results take precedence/i);
assert.match(input.systemAddendum ?? "", /non-authoritative context hint/i);
assert.match(input.systemAddendum ?? "", /live protocol-analysis turn/i);
assert.match(input.systemAddendum ?? "", /call getYieldSources first/i);
assert.match(input.systemAddendum ?? "", /call getAnalytics first/i);

assert.equal(historyFromBody("not an array").length, 0);
assert.equal(
  groundingFromBody([
    {
      title: "Docs",
      heading: "Safe",
      href: "/docs/networks",
      text: "ok",
    },
  ])?.[0]?.href,
  "/docs/networks",
);

console.log("Turn coordinator checks passed.");
