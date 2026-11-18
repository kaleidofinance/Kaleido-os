import assert from "node:assert/strict";
import { buildAcceptanceMatrix, acceptanceSummary } from "./acceptanceMatrix";
import { getCapabilitySnapshot } from "./capabilities";
import { createTask, resumeTask, transitionTask } from "./taskRuntime";
import { filterToolsForTurn, TOOL_CATALOG } from "./toolCatalog";
import { createTurnContext, turnContextError } from "./turnContext";
import { createAgentInput } from "./turnCoordinator";
import { recoverAgentTurn, runTurn, settleAgentTurn } from "./turnRunner";
import type { ChatInput, ChatProvider } from "./types";

async function main() {
  // 1. Scope validation rejects testnet chainId in mainnet mode.
  const mismatch = createTurnContext({
    chainId: 99801,
    showTestnets: false,
    address: "0x0000000000000000000000000000000000000001",
  });
  assert.equal(mismatch.chainStatus, "mode_mismatch");
  assert.match(turnContextError(mismatch) ?? "", /switch the network mode/i);

  // 2. Read-only mode strips all execute tools from the provider payload and suppresses proposals.
  const arcCaps = getCapabilitySnapshot({ chainId: 5042, networkMode: "mainnet" });
  const arcCtx = createTurnContext({
    chainId: 5042,
    showTestnets: false,
    address: "0x0000000000000000000000000000000000000001",
  });
  let seenTools: string[] = [];
  const fakePrimary: ChatProvider = {
    id: "primary",
    model: "primary-model",
    async chat(input: ChatInput) {
      seenTools = input.tools.map((t) => t.name);
      return {
        text: "Arc supports swaps, bridges, lending, and launchpads.",
        reads: [],
        executes: [{ name: "swap", args: { amount: "10", tokenIn: "USDC", tokenOut: "EURC" } }],
        provider: "primary",
        model: "primary-model",
      };
    },
  };
  const roInput = createAgentInput(
    { message: "What can I do on Arc?", readOnly: true },
    arcCtx,
    arcCaps,
  );
  const roRun = await runTurn({ providers: [fakePrimary], input: roInput });
  assert.ok(seenTools.length > 0 && seenTools.length < TOOL_CATALOG.length);
  assert.equal(seenTools.some((n) => n === "swap" || n === "claimTestTokens"), false);

  const roSettled = await settleAgentTurn({
    result: roRun,
    chainId: 5042,
    userText: "What can I do on Arc?",
    safeLimits: { slippageBps: 50 },
    primaryProvider: fakePrimary,
    readOnly: roInput.readOnly,
    quota: { used: 1, quota: 25, remaining: 24 },
    capabilities: arcCaps,
    startedAt: Date.now(),
    requestId: arcCtx.requestId,
  });
  assert.equal(roSettled.outcome.kind, "answer");
  assert.deepEqual(roSettled.context.plan, []);

  // 3. Failover disclosure when primary errors before streaming.
  const failingPrimary: ChatProvider = {
    id: "primary",
    model: "primary-model",
    async chat() {
      throw new Error("503 upstream");
    },
  };
  const backup: ChatProvider = {
    id: "backup",
    model: "backup-model",
    async chat() {
      return {
        text: "Answered from backup.",
        reads: [],
        executes: [],
        provider: "backup",
        model: "backup-model",
      };
    },
  };
  const foRun = await runTurn({
    providers: [failingPrimary, backup],
    input: { message: "hello", capabilities: arcCaps },
  });
  const foSettled = await settleAgentTurn({
    result: foRun,
    chainId: 5042,
    userText: "hello",
    safeLimits: { slippageBps: 50 },
    primaryProvider: failingPrimary,
    quota: { used: 1, quota: 25, remaining: 24 },
    capabilities: arcCaps,
    startedAt: Date.now(),
    requestId: "fo-1",
  });
  assert.equal(foSettled.context.failedOver, true);
  assert.match(foSettled.response, /backup-model answered this turn/);

  // 4. Content-blocked recovery classifies as non-retryable unavailable.
  const blocked = await recoverAgentTurn({
    aiError: new Error("400 content-blocked"),
    primaryProvider: failingPrimary,
    chainId: 5042,
    quota: { used: 1, quota: 25, remaining: 24, unmetered: true },
    capabilities: arcCaps,
    startedAt: Date.now(),
    requestId: "blk-1",
  });
  assert.equal(blocked.outcome.kind, "unavailable");
  if (blocked.outcome.kind === "unavailable") {
    assert.equal(blocked.outcome.reason, "provider_blocked");
    assert.equal(blocked.outcome.retryable, false);
  }

  // 5. Native tool round passes tool_use / role:tool messages cleanly.
  const roundMessages: ChatInput["messages"][] = [];
  let callCount = 0;
  const twoRound: ChatProvider = {
    id: "two-round",
    model: "two-round-model",
    async chat(input: ChatInput) {
      roundMessages.push([...input.messages]);
      callCount += 1;
      if (callCount === 1) {
        return {
          text: "",
          reads: [{ id: "tc_1", name: "getIntegrations", args: {} }],
          executes: [],
          provider: "two-round",
          model: "two-round-model",
        };
      }
      return {
        text: "Done.",
        reads: [],
        executes: [],
        provider: "two-round",
        model: "two-round-model",
      };
    },
  };
  const twoRun = await runTurn({
    providers: [twoRound],
    input: { message: "which integrations?", chainId: 5042, capabilities: arcCaps },
  });
  assert.equal(twoRun.rounds, 1);
  assert.equal(roundMessages[1]?.some((m) => m.role === "tool" && m.toolCallId === "tc_1"), true);

  // 6. Durable task state machine: idempotent transition + safe resume.
  let task = createTask({
    id: "task-1",
    idempotencyKey: "idem-1",
    objective: "Bridge and swap",
    contextVersion: "v1",
  });
  task = transitionTask(task, { eventId: "ev-1", status: "researching" });
  const replayed = transitionTask(task, { eventId: "ev-1", status: "preparing" });
  assert.equal(replayed.revision, task.revision);
  task = transitionTask(task, { eventId: "ev-2", status: "paused" });
  const resumed = resumeTask(task, "ev-3");
  assert.equal(resumed.status, "researching");

  // 7. Mainnet acceptance matrix builds cleanly.
  const summary = acceptanceSummary(buildAcceptanceMatrix("mainnet"));
  assert.ok(summary.total > 0);
  assert.ok(filterToolsForTurn(arcCaps).length < TOOL_CATALOG.length);

  console.log("Luca evaluation harness checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
