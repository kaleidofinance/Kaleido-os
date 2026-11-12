import assert from "node:assert/strict";
import { TOOL_CATALOG } from "./toolCatalog";
import { runReadTool } from "./readTools";

const declared = TOOL_CATALOG.find((tool) => tool.name === "getLendingAssets");
assert.equal(declared?.kind, "read");
const yieldTool = TOOL_CATALOG.find((tool) => tool.name === "getYieldSources");
assert.equal(yieldTool?.kind, "read");

(async () => {
  const unsupported = await runReadTool(
    "getLendingAssets",
    {},
    99901,
    undefined,
    "mainnet",
  );
  assert.equal(unsupported.status, "unsupported");
  assert.equal(unsupported.data, null);
  assert.deepEqual(unsupported.scope, {
    chainIds: [99901],
    networkMode: "mainnet",
  });
  assert.match(unsupported.warnings[0] ?? "", /not deployed/i);

  const yieldUnsupported = await runReadTool(
    "getYieldSources",
    {},
    99901,
    undefined,
    "mainnet",
  );
  assert.equal(yieldUnsupported.status, "unsupported");
  assert.equal(yieldUnsupported.data, null);

  console.log("Lending asset read checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
