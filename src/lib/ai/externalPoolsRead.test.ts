import assert from "node:assert/strict";
import { TOOL_CATALOG } from "./toolCatalog";
import { runReadTool } from "./readTools";

const descriptor = TOOL_CATALOG.find((tool) => tool.name === "getExternalPools");
assert.equal(descriptor?.kind, "read");

(async () => {
  const arc = await runReadTool(
    "getExternalPools",
    { asset: "USDC", limit: 5 },
    5042,
    undefined,
    "mainnet",
  );
  assert.equal(arc.status, "ok");
  assert.equal(arc.data?.chainId, 5042);
  assert.equal(arc.data?.executionSupported, false);
  assert.equal(typeof arc.data?.refreshDueAt, "string");
  assert.equal(typeof arc.data?.refreshDue, "boolean");
  assert.ok(Array.isArray(arc.data?.pools));
  assert.ok((arc.data?.pools as unknown[]).length > 0);
  assert.ok(
    (arc.data?.pools as Array<{ tokenSymbols: string[] }>).every((pool) =>
      pool.tokenSymbols.includes("USDC"),
    ),
  );
  assert.equal(arc.evidence?.status, "ok");

  const bsc = await runReadTool(
    "getExternalPools",
    { targetChain: "BSC", limit: 2 },
    5042,
    undefined,
    "mainnet",
  );
  assert.equal(bsc.status, "ok");
  assert.equal(bsc.data?.chainId, 56);
  assert.ok((bsc.data?.pools as unknown[]).length <= 2);

  const elysium = await runReadTool(
    "getExternalPools",
    {},
    99901,
    undefined,
    "mainnet",
  );
  assert.equal(elysium.status, "ok");
  assert.equal(elysium.data?.chainId, 99901);
  assert.equal(elysium.data?.executionSupported, false);
  assert.equal((elysium.data?.pools as unknown[]).length, 3);

  const testnet = await runReadTool(
    "getExternalPools",
    {},
    5042002,
    undefined,
    "testnet",
  );
  assert.equal(testnet.status, "unsupported");

  console.log("External pool read checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
