import assert from "node:assert/strict";
import { acceptanceSummary, buildAcceptanceMatrix } from "./acceptanceMatrix";

const mainnet = buildAcceptanceMatrix("mainnet");
assert.ok(mainnet.some((item) => item.chainId === 99901 && item.capabilityId === "swap"));
assert.ok(mainnet.some((item) => item.state === "needs_live_check"));
const summary = acceptanceSummary(mainnet);
assert.equal(summary.total, mainnet.length);
assert.equal(summary.configured + summary.needs_live_check + summary.not_configured, summary.total);
assert.ok(buildAcceptanceMatrix("testnet").some((item) => item.networkMode === "testnet"));
console.log("Acceptance matrix checks passed.");
