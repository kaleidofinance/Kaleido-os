/**
 * Analytics overview — the pure aggregation of the /analytics KPIs, offline.
 * Run: `npx tsx src/lib/analytics/overview.test.ts`.
 *
 * The DB readers are integration-only; the summarisers that turn raw rows into
 * the page's numbers are pure and are what is tested here.
 */

import { summarizeActions, summarizeTurns } from "@/lib/analytics/overview";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL: ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`);
  }
}

console.log("— summarizeActions: unique wallets, total + per-source points —");
{
  const r = summarizeActions([
    { wallet: "0xAAA", points: "100", source_slug: "swap" },
    { wallet: "0xaaa", points: 50, source_slug: "swap" }, // same wallet, lower-cased
    { wallet: "0xBBB", points: 30, source_slug: "referral" },
    { wallet: "0xBBB", points: "0", source_slug: "swap" }, // zero adds nothing
    { wallet: "", points: 10, source_slug: "swap" }, // no wallet
    { wallet: "0xCCC", points: "x", source_slug: "lp" }, // junk points
  ]);
  check("unique wallets are case-folded + deduped", r.uniqueWallets === 3, r.uniqueWallets);
  check("total points sums only positive numbers", r.totalPoints === 190, r.totalPoints);
  check("per-source: swap = 100+50+10", r.bySource.swap === 160, r.bySource);
  check("per-source: referral = 30", r.bySource.referral === 30);
  check("a junk-points row adds no source bucket", r.bySource.lp === undefined);
}
{
  const r = summarizeActions([]);
  check("empty → zeros", r.uniqueWallets === 0 && r.totalPoints === 0 && Object.keys(r.bySource).length === 0);
}

console.log("\n— summarizeTurns: count, success rate, avg latency —");
{
  const r = summarizeTurns([
    { status: "ok", latency_ms: 1000 },
    { status: "ok", latency_ms: 3000 },
    { status: "refused", latency_ms: 800 }, // a correct decline → HANDLED, not a failure
    { status: "provider_error", latency_ms: null }, // real error
    { status: "build_error", latency_ms: 500 }, // real error
  ]);
  check("turns = row count", r.turns === 5);
  check("handled rate counts refused as handled: (5 - 2 errors) / 5", Math.abs(r.handledRate - 0.6) < 1e-9, r.handledRate);
  check("avg latency ignores null, averages the rest", r.avgLatencyMs === 1325, r.avgLatencyMs);
}
{
  const r = summarizeTurns([]);
  check("no turns → rate 0, latency null", r.turns === 0 && r.handledRate === 0 && r.avgLatencyMs === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
