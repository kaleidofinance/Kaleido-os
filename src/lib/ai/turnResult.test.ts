import assert from "node:assert/strict";
import { classifyTurn, isSignable, type TurnPlanState } from "./turnResult";
import type { AgentRun } from "./agent";

const run: AgentRun = {
  text: "Ready.",
  reads: [],
  executes: [],
  provider: "test",
  model: "test",
  trace: [],
  rounds: 0,
};

const passed: TurnPlanState = { audit: "passed", simulation: "passed" };
assert.equal(classifyTurn(run, { kind: "answer" }).kind, "answer");
assert.equal(classifyTurn(run, { kind: "clarification" }).kind, "clarification");
assert.equal(classifyTurn(run, { kind: "plan", plan: passed }).kind, "plan");
assert.equal(isSignable(classifyTurn(run, { kind: "plan", plan: passed })), true);

const failed = classifyTurn(run, {
  kind: "plan",
  plan: { audit: "passed", simulation: "unavailable" },
});
assert.equal(failed.kind, "unavailable");
assert.equal(failed.reason, "plan_not_verified");
assert.equal(failed.retryable, true);

console.log("Turn result checks passed.");
