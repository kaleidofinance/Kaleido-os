import assert from "node:assert/strict";
import { TOOL_CATALOG } from "./toolCatalog";
import { runReadTool } from "./readTools";

const descriptor = TOOL_CATALOG.find((tool) => tool.name === "getAnalytics");
assert.ok(descriptor, "getAnalytics is catalogued");
assert.deepEqual(descriptor?.parameters.properties?.scope?.enum, ["all"]);

(async () => {
  const testnet = await runReadTool(
    "getAnalytics",
    { scope: "all" },
    99801,
    false,
    "testnet",
  );
  assert.equal(testnet.status, "unsupported");
  assert.match(String(testnet.warnings?.[0]), /mainnet-scoped/i);

  const all = await runReadTool(
    "getAnalytics",
    { scope: "all", metric: "revenue" },
    5042,
    true,
    "mainnet",
  );
  // Local test runs intentionally have no Supabase credentials. The important
  // contract is that a missing ledger is unavailable, never a fabricated zero.
  assert.ok(all.status === "ok" || all.status === "partial" || all.status === "unavailable");
  if (all.status === "unavailable") assert.equal(all.data, null);
  console.log("Analytics read checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
