import assert from "node:assert/strict";
import { isCurrentChainQuestion, walletChainContext } from "./walletContext";

assert.equal(isCurrentChainQuestion("what chain are we now?"), true);
assert.equal(isCurrentChainQuestion("Which network am I connected to?"), true);
assert.equal(isCurrentChainQuestion("what chains are supported?"), false);
assert.match(walletChainContext(99801), /Elysium/i);
assert.match(walletChainContext(4663), /Robinhood/i);
assert.match(walletChainContext(undefined), /Do not guess/i);
assert.match(walletChainContext(999999999), /unrecognised/i);
console.log("Wallet chain context checks passed.");
