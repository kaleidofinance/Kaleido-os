import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/agent/tasks/route";
import {
  createTask,
  transitionTask,
  resumeTask,
  canResumeTask,
  isTerminalTaskStatus,
  type AgentTask,
  type TaskStore,
  persistTask,
} from "./taskRuntime";

async function runTests() {
  console.log("Testing Task Runtime and API Route...");

  // 1. Task Runtime with address scoping
  const userAddress = "0x1234567890123456789012345678901234567890";
  const task = createTask({
    id: "task-test-1",
    idempotencyKey: `${userAddress}:move-usdc`,
    address: userAddress,
    objective: "Bridge 100 USDC to Elysium",
    contextVersion: "v1",
  });

  assert.equal(task.address, userAddress.toLowerCase());
  assert.equal(task.status, "created");
  assert.equal(task.revision, 0);

  // Transition to researching
  const researching = transitionTask(task, {
    eventId: "ev-1",
    status: "researching",
  });
  assert.equal(researching.status, "researching");
  assert.equal(researching.revision, 1);

  // Transition to paused
  const paused = transitionTask(researching, {
    eventId: "ev-2",
    status: "paused",
  });
  assert.equal(paused.status, "paused");
  assert.equal(canResumeTask(paused), true);

  // Resume task
  const resumed = resumeTask(paused, "ev-3");
  assert.equal(resumed.status, "researching");
  assert.equal(resumed.revision, 3);

  // Transition through valid pipeline
  const preparing = transitionTask(resumed, {
    eventId: "ev-4",
    status: "preparing",
  });
  assert.equal(preparing.status, "preparing");

  const checking = transitionTask(preparing, {
    eventId: "ev-5",
    status: "checking",
  });
  assert.equal(checking.status, "checking");

  const awaiting = transitionTask(checking, {
    eventId: "ev-6",
    status: "awaiting_approval",
  });
  assert.equal(awaiting.status, "awaiting_approval");

  const submitting = transitionTask(awaiting, {
    eventId: "ev-7",
    status: "submitting",
  });
  assert.equal(submitting.status, "submitting");

  const confirming = transitionTask(submitting, {
    eventId: "ev-8",
    status: "confirming",
  });
  assert.equal(confirming.status, "confirming");

  const completed = transitionTask(confirming, {
    eventId: "ev-9",
    status: "completed",
  });
  assert.equal(completed.status, "completed");
  assert.equal(isTerminalTaskStatus(completed.status), true);
  assert.equal(canResumeTask(completed), false);

  // 2. In-memory TaskStore optimistic locking
  const memoryStore = new Map<string, { task: AgentTask; revision: number }>();
  const testStore: TaskStore = {
    async get(key: string) {
      return memoryStore.get(key)?.task ?? null;
    },
    async put(next: AgentTask, expectedRevision: number) {
      const current = memoryStore.get(next.idempotencyKey);
      if (expectedRevision < 0) {
        if (current) throw new Error("Duplicate task");
        memoryStore.set(next.idempotencyKey, { task: next, revision: next.revision });
        return next;
      }
      if (!current || current.revision !== expectedRevision) {
        throw new Error(`Revision conflict: expected ${expectedRevision}`);
      }
      memoryStore.set(next.idempotencyKey, { task: next, revision: next.revision });
      return next;
    },
  };

  // Persist initial task
  await testStore.put(task, -1);
  const fetched = await testStore.get(task.idempotencyKey);
  assert.equal(fetched?.id, task.id);

  // Persist transition
  await persistTask(testStore, researching);
  const updated = await testStore.get(task.idempotencyKey);
  assert.equal(updated?.revision, 1);
  assert.equal(updated?.status, "researching");

  // Outdated revision write must fail
  await assert.rejects(
    async () => {
      await testStore.put(paused, 0); // expects revision 0, but current is 1
    },
    /Revision conflict/,
  );

  // 3. API Route GET validation
  {
    const reqInvalid = new NextRequest("http://localhost:3000/api/agent/tasks?address=invalid");
    const resInvalid = await GET(reqInvalid);
    assert.equal(resInvalid.status, 400);
    const jsonInvalid = await resInvalid.json();
    assert.equal(jsonInvalid.ok, false);

    const reqValid = new NextRequest(`http://localhost:3000/api/agent/tasks?address=${userAddress}`);
    const resValid = await GET(reqValid);
    assert.equal(resValid.status, 200);
    const jsonValid = await resValid.json();
    assert.equal(jsonValid.ok, true);
    assert.ok(Array.isArray(jsonValid.tasks));
  }

  // 4. API Route POST validation
  {
    // Missing address
    const reqNoAddr = new NextRequest("http://localhost:3000/api/agent/tasks", {
      method: "POST",
      body: JSON.stringify({ action: "create" }),
    });
    const resNoAddr = await POST(reqNoAddr);
    assert.equal(resNoAddr.status, 400);

    // Invalid idempotencyKey
    const reqNoKey = new NextRequest("http://localhost:3000/api/agent/tasks", {
      method: "POST",
      body: JSON.stringify({ address: userAddress, action: "create" }),
    });
    const resNoKey = await POST(reqNoKey);
    // When Supabase is unconfigured, returns 503; if configured, returns 400 for missing key
    assert.ok([400, 503].includes(resNoKey.status));
  }

  console.log("Task Runtime and API Route checks passed.");
}

runTests().catch((err) => {
  console.error("Task API test failed:", err);
  process.exitCode = 1;
});
