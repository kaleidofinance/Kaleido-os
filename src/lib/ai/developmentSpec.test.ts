import assert from "node:assert/strict";
import { prepareDevelopmentPlan } from "./developmentSpec";

const empty = prepareDevelopmentPlan({ objective: "", chainId: 5042, networkMode: "mainnet" });
assert.equal(empty.readiness, "invalid");
const plan = prepareDevelopmentPlan({ objective: "Rebalance this position", chainId: 5042, networkMode: "mainnet" });
assert.equal(plan.readiness, "unsupported");
assert.equal(plan.requiresUserApproval, true);
assert.deepEqual(plan.artifacts, []);
console.log("Development spec checks passed.");
