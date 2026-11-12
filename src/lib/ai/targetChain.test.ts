import assert from "node:assert/strict";
import { targetChainHint } from "./targetChain";

assert.equal(targetChainHint("find yield on Elysium", "mainnet"), 99901);
assert.equal(targetChainHint("compare BSC and Arc liquidity", "mainnet"), undefined);
assert.equal(targetChainHint("show all chains revenue", "mainnet"), undefined);
assert.equal(targetChainHint("find pools on Elysium Testnet", "testnet"), 99801);
assert.equal(targetChainHint("find pools on Elysium", "testnet"), 99801);
console.log("Target-chain hint checks passed.");
