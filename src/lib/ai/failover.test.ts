/*
 * runAgentWithFailover — the model-provider failover, including the stall
 * watchdog. Run with `npx tsx src/lib/ai/failover.test.ts`.
 *
 * Distinct from test:failover, which is the RPC (chain read) failover. This one
 * pins the property the doc-comment long claimed but did not have: a HUNG primary
 * fails over. A provider's own request timeout equals the whole function budget,
 * so waiting for a stalled provider to throw left no time for a backend that
 * would answer — the failover reached the second provider only on a FAST error.
 *
 * AGENT_STALL_MS is set small BEFORE the import, because agent.ts reads it once at
 * module load; the providers are fakes, so no network, model or chain is touched.
 */
process.env.AGENT_STALL_MS = "50";

import type { ChatProvider, ChatResult } from "./types.ts";
import type { AgentInput } from "./agent.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got ? " " + got : ""}`);
  }
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const result = (id: string): ChatResult => ({
  text: id,
  executes: [],
  reads: [],
  provider: id,
  model: `${id}-model`,
});

type Behavior = "answer" | "hang" | "throw" | "slowAlive" | "slowJson";

const provider = (id: string, behavior: Behavior): ChatProvider => ({
  id,
  model: `${id}-model`,
  chat: async () => {
    if (behavior === "throw") throw new Error(`${id} down`);
    if (behavior === "hang") return new Promise<ChatResult>(() => {});
    if (behavior === "slowJson") {
      await delay(200);
      return result(id);
    }
    return result(id);
  },
  chatStream: async (_input, onText) => {
    if (behavior === "throw") throw new Error(`${id} down`);
    if (behavior === "hang") return new Promise<ChatResult>(() => {});
    if (behavior === "slowAlive") {
      onText("…"); // a sign of life BEFORE the stall window closes
      await delay(200);
      return result(id);
    }
    onText(id);
    return result(id);
  },
});

async function main() {
  const { runAgentWithFailover } = await import("./agent.ts");
  // No address, so runAgent seeds no portfolio read and touches no chain.
  const input = { message: "hi", history: [] } as AgentInput;
  const streaming = { onText: () => {}, onReads: () => {} };

  console.log("\n— a hung provider fails over —");

  {
    const r = await runAgentWithFailover(
      [provider("hung", "hang"), provider("live", "answer")],
      input,
      streaming,
    );
    check(
      "a primary that emits nothing within the window is abandoned for the next",
      r.provider === "live",
      `answered by ${r.provider}`,
    );
  }

  console.log("\n— but a slow, LIVE provider is not —");

  {
    const r = await runAgentWithFailover(
      [provider("slow", "slowAlive"), provider("live", "answer")],
      input,
      streaming,
    );
    check(
      "a provider that has emitted is waited for past the window, not failed over",
      r.provider === "slow",
      `answered by ${r.provider}`,
    );
  }

  console.log("\n— the existing behaviours are unchanged —");

  {
    const r = await runAgentWithFailover(
      [provider("bad", "throw"), provider("live", "answer")],
      input,
      streaming,
    );
    check(
      "a thrown error still fails over",
      r.provider === "live",
      `answered by ${r.provider}`,
    );
  }

  {
    // No events = the JSON path, which emits nothing until the end, so a slow
    // provider must NOT be mistaken for a hung one and abandoned.
    const r = await runAgentWithFailover(
      [provider("slowj", "slowJson"), provider("live", "answer")],
      input,
      undefined,
    );
    check(
      "the JSON path is not watchdogged — slow is not hung there",
      r.provider === "slowj",
      `answered by ${r.provider}`,
    );
  }

  {
    // A single hung provider that is also the last has nowhere to fail over to,
    // so it is not watchdogged; a live single provider just answers.
    const r = await runAgentWithFailover(
      [provider("only", "answer")],
      input,
      streaming,
    );
    check("a lone provider answers", r.provider === "only", r.provider);
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
