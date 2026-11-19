import assert from "node:assert/strict";
import {
  aggregatorIntegrations,
  integrationOperationStatus,
  launchpadIntegrations,
} from "./integrationCatalog";

const arcLaunchpads = launchpadIntegrations(5042);
assert.deepEqual(
  arcLaunchpads.map((item) => item.name),
  ["Argus", "Peach", "Synthra LaunchPad"],
);
assert.equal(
  arcLaunchpads.every((item) => item.networkMode === "mainnet"),
  true,
);
assert.equal(
  integrationOperationStatus(arcLaunchpads[1], "inspect"),
  "available",
);
assert.equal(
  integrationOperationStatus(arcLaunchpads[1], "trade"),
  "available",
);
assert.equal(
  integrationOperationStatus(arcLaunchpads[1], "createToken"),
  "not_configured",
);

assert.deepEqual(
  aggregatorIntegrations(5042).map((item) => item.name),
  ["Synthra", "KyberSwap", "LI.FI", "Fly.trade", "Tower Exchange"],
);

assert.deepEqual(launchpadIntegrations(56), []);
assert.deepEqual(
  launchpadIntegrations(4663).map((item) => item.name),
  ["Synthra LaunchPad"],
);
assert.deepEqual(
  aggregatorIntegrations(4663).map((item) => item.name),
  ["Synthra", "KyberSwap", "LI.FI", "Fly.trade"],
);
assert.deepEqual(launchpadIntegrations(99801, "testnet"), []);
const elysiumLaunchpads = launchpadIntegrations(99901);
assert.equal(elysiumLaunchpads.length, 12);
assert.deepEqual(
  elysiumLaunchpads.map((item) => item.name),
  [
    "Montra",
    "BOXA",
    "Ascend",
    "Mesa",
    "Volta",
    "Kleos",
    "ElysPump",
    "Eleos",
    "RONS",
    "Obol",
    "KSTR",
    "Quoted",
  ],
);
assert.equal(
  elysiumLaunchpads.every(
    (item) => integrationOperationStatus(item, "trade") === "available",
  ),
  true,
);
assert.equal(
  elysiumLaunchpads.every(
    (item) =>
      integrationOperationStatus(item, "createToken") === "not_configured",
  ),
  true,
);
assert.deepEqual(
  aggregatorIntegrations(56).map((item) => item.name),
  ["KyberSwap", "LI.FI", "Fly.trade"],
);
assert.equal(aggregatorIntegrations(99801, "testnet").length, 0);

console.log("Integration catalog checks passed.");
