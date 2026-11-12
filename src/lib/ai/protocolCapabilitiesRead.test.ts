import assert from "node:assert/strict";
import { TOOL_CATALOG } from "./toolCatalog";
import { runReadTool } from "./readTools";

const descriptor = TOOL_CATALOG.find(
  (tool) => tool.name === "getProtocolCapabilities",
);
assert.equal(descriptor?.kind, "read");

const capability = (result: any, id: string) =>
  (result.data.capabilities as Array<{ id: string; status: string }>).find(
    (item) => item.id === id,
  );

(async () => {
  const arc = await runReadTool(
    "getProtocolCapabilities",
    {},
    5042,
    undefined,
    "mainnet",
  );
  assert.equal(arc.status, "ok");
  assert.equal(arc.data.chainId, 5042);
  assert.equal(capability(arc, "launchpads")?.status, "available");
  assert.equal(capability(arc, "swap")?.status, "available");
  assert.equal(arc.evidence.status, "ok");

  const elysium = await runReadTool(
    "getProtocolCapabilities",
    { targetChain: "Elysium" },
    5042,
    undefined,
    "mainnet",
  );
  assert.equal(elysium.status, "ok");
  assert.equal(elysium.data.chainId, 99901);
  assert.equal(capability(elysium, "launchpads")?.status, "not_configured");

  const wrongMode = await runReadTool(
    "getProtocolCapabilities",
    { targetChain: "Elysium Testnet" },
    5042,
    undefined,
    "mainnet",
  );
  assert.match(wrongMode.error, /switch network mode/i);
  assert.equal(wrongMode.evidence.status, "unavailable");

  console.log("Protocol capability read checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
