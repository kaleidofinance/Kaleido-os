import assert from "node:assert/strict";
import {
  aggregatorIntegrations,
  integrationOperationStatus,
  launchpadIntegrations,
} from "./integrationCatalog";

const arcLaunchpads = launchpadIntegrations(5042);
assert.deepEqual(
  arcLaunchpads.map((item) => item.name),
  ["Argus", "Peach"],
);
assert.equal(arcLaunchpads.every((item) => item.networkMode === "mainnet"), true);
assert.equal(integrationOperationStatus(arcLaunchpads[1], "inspect"), "available");
assert.equal(integrationOperationStatus(arcLaunchpads[1], "trade"), "available");
assert.equal(integrationOperationStatus(arcLaunchpads[1], "createToken"), "not_configured");

assert.deepEqual(launchpadIntegrations(56), []);
assert.deepEqual(launchpadIntegrations(99801, "testnet"), []);
assert.deepEqual(
  aggregatorIntegrations(56).map((item) => item.name),
  ["KyberSwap", "LI.FI", "Fly.trade"],
);
assert.equal(aggregatorIntegrations(99801, "testnet").length, 0);

console.log("Integration catalog checks passed.");
