/**
 * postWithRetry: the fire-and-forget POST PlanReview uses to tell the waitlist
 * verifier and the bridge recorder about a confirmed tx. Retries only what can
 * change with time (the node hasn't indexed the receipt yet); stops on a
 * definite answer. Run with `npx tsx src/lib/v2/postWithRetry.test.ts`.
 */
import { isRetryableResponse, postWithRetry } from "./postWithRetry.ts";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

/** A fake fetch that answers each call from a script of [status, body]. */
function scripted(steps: Array<[number, unknown] | "throw">) {
  let calls = 0;
  const impl = (async () => {
    const step = steps[Math.min(calls, steps.length - 1)];
    calls++;
    if (step === "throw") throw new Error("network");
    const [status, body] = step;
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls: () => calls };
}
const noSleep = async () => {};

async function main() {
  console.log("\n— which answers are worth asking again for —");
  check("409 tx not found (receipt not indexed yet) → retry", isRetryableResponse(409, { error: "successful wallet transaction not found" }));
  check("409 not a recognized route → stop", !isRetryableResponse(409, { error: "transaction is not a recognized bridge route" }));
  check("404 tx not found (recorder) → retry", isRetryableResponse(404, { error: "tx not found" }));
  check("5xx → retry", isRetryableResponse(502, null) && isRetryableResponse(503, { error: "rpc" }));
  check("429 → retry", isRetryableResponse(429, null));
  check("410 retired task → stop", !isRetryableResponse(410, { error: "this task has been retired" }));
  check("400 / 422 → stop", !isRetryableResponse(400, null) && !isRetryableResponse(422, { error: "tx not from wallet" }));

  console.log("\n— the retry loop —");
  {
    const f = scripted([[409, { error: "successful wallet transaction not found" }], [409, { error: "successful wallet transaction not found" }], [200, { ok: true }]]);
    const ok = await postWithRetry("/x", {}, { fetchImpl: f.impl, sleep: noSleep });
    check("a lagging node: fails twice, then verifies", ok && f.calls() === 3, `calls=${f.calls()}`);
  }
  {
    const f = scripted([[409, { error: "transaction is not a recognized bridge route" }]]);
    const ok = await postWithRetry("/x", {}, { fetchImpl: f.impl, sleep: noSleep });
    check("a definite refusal stops after one call", !ok && f.calls() === 1, `calls=${f.calls()}`);
  }
  {
    const f = scripted(["throw", [200, {}]]);
    const ok = await postWithRetry("/x", {}, { fetchImpl: f.impl, sleep: noSleep });
    check("a network error is retried", ok && f.calls() === 2, `calls=${f.calls()}`);
  }
  {
    const f = scripted([[503, null]]);
    const waits: number[] = [];
    const ok = await postWithRetry("/x", {}, { fetchImpl: f.impl, sleep: async (ms) => { waits.push(ms); }, delaysMs: [1, 2, 3] });
    check("gives up after the last delay, never throws", !ok && f.calls() === 4 && waits.join(",") === "1,2,3", `calls=${f.calls()} waits=${waits}`);
  }
  {
    const f = scripted([[200, { ok: true }]]);
    const ok = await postWithRetry("/x", {}, { fetchImpl: f.impl, sleep: noSleep });
    check("success on the first try makes one call", ok && f.calls() === 1);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
