import assert from "node:assert/strict";
import {
  capabilityFor,
  capabilityPrompt,
  getCapabilitySnapshot,
} from "./capabilities";

const bsc = getCapabilitySnapshot({ chainId: 56, networkMode: "mainnet" });
assert.equal(bsc.chainName, "BNB Smart Chain");
assert.equal(capabilityFor(bsc, "swap")?.status, "available");
assert.equal(capabilityFor(bsc, "liquidity")?.status, "available");
assert.equal(capabilityFor(bsc, "lending")?.status, "available");
assert.equal(capabilityFor(bsc, "launchpads")?.status, "not_configured");
assert.match(capabilityPrompt(bsc), /Server-owned capability snapshot/);
assert.match(capabilityPrompt(bsc), /liquidity: available/);

const elysium = getCapabilitySnapshot({
  chainId: 99801,
  networkMode: "testnet",
});
assert.equal(elysium.chainName, "Elysium Testnet");
assert.equal(capabilityFor(elysium, "swap")?.status, "available");
assert.equal(capabilityFor(elysium, "lending")?.status, "available");
assert.equal(capabilityFor(elysium, "launchpads")?.status, "not_configured");

const arc = getCapabilitySnapshot({ chainId: 5042, networkMode: "mainnet" });
assert.equal(capabilityFor(arc, "launchpads")?.status, "available");
assert.match(capabilityPrompt(arc), /Argus and Peach/);

const unknown = getCapabilitySnapshot({
  chainId: 999999,
  networkMode: "testnet",
});
assert.equal(unknown.records[0]?.status, "unknown");

const walletless = getCapabilitySnapshot({ networkMode: "mainnet" });
assert.equal(walletless.chainName, "mainnet networks");
assert.equal(walletless.chainId, undefined);
assert.equal(capabilityFor(walletless, "swap")?.status, "available");
assert.match(capabilityPrompt(walletless), /scope=mainnet networks/);

console.log("Capability snapshot checks passed.");
