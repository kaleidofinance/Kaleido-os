import assert from "node:assert/strict";
import { TOOL_CATALOG } from "./toolCatalog";
import { runReadTool } from "./readTools";

(async () => {
  const declared = TOOL_CATALOG.find((tool) => tool.name === "getIntegrations");
  assert.equal(declared?.kind, "read");

  const arc = await runReadTool(
    "getIntegrations",
    {},
    5042,
    undefined,
    "mainnet",
  );
  assert.equal(arc.status, "ok");
  assert.equal(arc.source, "canonical integration catalog");
  assert.deepEqual(arc.scope, { chainIds: [5042], networkMode: "mainnet" });
  assert.equal(arc.coverage.failed.length, 0);
  const arcData = arc.data as Record<string, unknown>;
  assert.deepEqual(
    (arcData.integrations as Array<Record<string, unknown>>).map(
      (item) => item.name,
    ),
    ["Argus", "Peach", "KyberSwap", "LI.FI", "Fly.trade"],
  );
  const argusOperations = (
    (arcData.integrations as Array<Record<string, unknown>>)[0]?.operations ?? {}
  ) as Record<string, unknown>;
  assert.equal(
    argusOperations.trade,
    "degraded",
  );
  assert.equal(argusOperations.createToken, "not_configured");

  const testnet = await runReadTool(
    "getIntegrations",
    {},
    99801,
    undefined,
    "testnet",
  );
  assert.equal(testnet.status, "ok");
  assert.deepEqual((testnet.data as Record<string, unknown>).integrations, []);

  const wrongScope = await runReadTool(
    "getIntegrations",
    {},
    5042,
    undefined,
    "testnet",
  );
  assert.equal(wrongScope.status, "unsupported");
  assert.equal(wrongScope.data, null);
  assert.match(wrongScope.warnings[0] ?? "", /belongs to mainnet/i);

  const research = await runReadTool(
    "researchSources",
    { urls: ["http://localhost/private"] },
    5042,
    undefined,
    "mainnet",
  );
  assert.equal(research.evidence?.status, "partial");
  assert.deepEqual(research.evidence?.scope, {
    chainIds: [],
    networkMode: "mainnet",
  });

  console.log("Integration read tool checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
