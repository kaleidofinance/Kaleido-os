import assert from "node:assert/strict";
import { prepareLaunchpadCreation } from "./launchpadCreation";

const plan = prepareLaunchpadCreation({
  chainId: 5042,
  networkMode: "mainnet",
  launchpadId: "peach",
  name: "Test",
  symbol: "TST",
});
assert.equal(plan.readiness, "unsupported");
assert.equal(plan.integration?.name, "Peach");
assert.equal(plan.requiresUserApproval, true);
assert.match(plan.reason, /not configured/i);
console.log("Launchpad creation checks passed.");
