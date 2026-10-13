/**
 * describePlan / newFills. Run: npx tsx src/lib/notifications/activity.test.ts
 */
import { describePlan, newFills } from "./activity";
import { categorise } from "./taxonomy";
import type { Intent } from "@/lib/v2/intents/types";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const I = (kind: string) => ({ kind }) as unknown as Intent;
const step = (title: string, skipped = false) => ({ title, skipped });

{
  const n = describePlan([I("approve"), I("aggregatorSwap")], [step("Approve USDC", true), step("Swap 50 USDC → EURC")]);
  check("swap after approve is a swap", n?.title === "Swap confirmed" && n.actionType === "trade_executed", JSON.stringify(n));
  check("body is the swap step, approve dropped", n?.body === "Swap 50 USDC → EURC", n?.body);
  check("swap files under Orders", categorise("trade_executed") === "orders");
}
{
  const n = describePlan([I("placeOrder")], [step("Place limit order")]);
  check("placeOrder → order_placed", n?.actionType === "order_placed" && n.title === "Limit order placed", JSON.stringify(n));
}
{
  const n = describePlan([I("cancelAllOrders")], [step("Cancel 3 orders")]);
  check("cancel all → order_cancelled", n?.actionType === "order_cancelled", JSON.stringify(n));
}
{
  const n = describePlan([I("approve"), I("bridge")], [step("Approve USDC"), step("Bridge 20 USDC to Arc")]);
  check("bridge → bridge_executed", n?.actionType === "bridge_executed" && n.title === "Bridge sent", JSON.stringify(n));
  check("a non-skipped approve is still left out of the body", n?.body === "Bridge 20 USDC to Arc", n?.body);
}
{
  const n = describePlan([I("swap")], [step("Swap 1 WUSDC → EURC")], "agent");
  check("agent plan → agent_action under Agent", n?.actionType === "agent_action" && categorise("agent_action") === "agent", JSON.stringify(n));
  check("agent title is prefixed Luca", n?.title === "Luca: swap confirmed", n?.title);
}
check("an approve-only plan says nothing", describePlan([I("approve")], [step("Approve")]) === null);
check("order_filled is an Orders category", categorise("order_filled") === "orders");

const row = (hash: string, fills: number, interval = 0) => ({ hash, fills, tokenIn: "0xa", tokenOut: "0xb", interval });
{
  const r = newFills([row("0xAA", 2)], null);
  check("first read is a baseline: nothing announced", r.filled.length === 0);
  check("baseline records current fills (lowercased key)", r.next["0xaa"] === 2, JSON.stringify(r.next));
}
{
  const r = newFills([row("0xaa", 3), row("0xbb", 1)], { "0xaa": 2, "0xbb": 1 });
  check("a fill count that went up is announced once", r.filled.length === 1 && r.filled[0].hash === "0xaa");
  const again = newFills([row("0xaa", 3), row("0xbb", 1)], r.next);
  check("the same state again announces nothing", again.filled.length === 0);
}
{
  const r = newFills([row("0xcc", 1)], { "0xaa": 2 });
  check("a new order already filled since baseline is announced", r.filled.length === 1 && r.filled[0].hash === "0xcc");
}
{
  const r = newFills([row("0xaa", 0)], { "0xaa": 0 });
  check("an unfilled order is not announced", r.filled.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
