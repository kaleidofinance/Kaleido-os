import assert from "node:assert/strict";
import {
  canResumeTask,
  createTask,
  persistTask,
  resumeTask,
  transitionTask,
  type AgentTask,
  type TaskStore,
} from "./taskRuntime";

const task = createTask({
  id: "task-1",
  idempotencyKey: "wallet:strategy:1",
  objective: "Move idle USDC to the approved opportunity",
  contextVersion: "ctx-1",
  now: "2026-11-09T00:00:00.000Z",
});

const researching = transitionTask(task, {
  eventId: "event-1",
  status: "researching",
  now: "2026-11-09T00:00:01.000Z",
});
assert.equal(researching.status, "researching");
assert.equal(researching.revision, 1);

const replay = transitionTask(researching, {
  eventId: "event-1",
  status: "preparing",
});
assert.equal(replay, researching);

assert.throws(
  () => transitionTask(researching, { eventId: "event-bad", status: "completed" }),
  /Invalid task transition/,
);

const completed = transitionTask(
  transitionTask(
    transitionTask(researching, { eventId: "event-2", status: "preparing" }),
    { eventId: "event-3", status: "checking" },
  ),
  { eventId: "event-4", status: "awaiting_approval" },
);
assert.equal(completed.status, "awaiting_approval");

const paused = transitionTask(researching, {
  eventId: "event-pause",
  status: "paused",
});
assert.equal(canResumeTask(paused), true);
assert.equal(
  resumeTask(paused, "event-resume", "2026-11-09T00:00:03.000Z").status,
  "researching",
);
assert.equal(canResumeTask(completed), false);

const writes: Array<{ task: AgentTask; expectedRevision: number }> = [];
const store: TaskStore = {
  async get() {
    return null;
  },
  async put(next, expectedRevision) {
    writes.push({ task: next, expectedRevision });
    return next;
  },
};

(async () => {
  await persistTask(store, researching);
  assert.equal(writes[0]?.expectedRevision, 0);
  console.log("Task runtime checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
