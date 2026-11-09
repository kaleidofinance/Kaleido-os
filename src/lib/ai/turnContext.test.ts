import assert from "node:assert/strict";
import { createTurnContext, turnContextError } from "./turnContext";

const mainnet = createTurnContext({
  address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
  chainId: 5042,
  showTestnets: false,
  requestId: "turn-1",
});
assert.equal(mainnet.chainId, 5042);
assert.equal(mainnet.networkMode, "mainnet");
assert.equal(mainnet.chainStatus, "valid");
assert.equal(mainnet.address, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
assert.equal(mainnet.requestId, "turn-1");
assert.equal(turnContextError(mainnet), null);

const mismatch = createTurnContext({ chainId: 5042002, showTestnets: false });
assert.equal(mismatch.chainId, undefined);
assert.equal(mismatch.chainStatus, "mode_mismatch");
assert.match(turnContextError(mismatch) ?? "", /testnet mode/i);

const unknown = createTurnContext({ chainId: 999999, showTestnets: true });
assert.equal(unknown.chainId, undefined);
assert.equal(unknown.chainStatus, "unknown");
assert.match(turnContextError(unknown) ?? "", /not in Kaleido's chain registry/i);

const walletless = createTurnContext({ showTestnets: true });
assert.equal(walletless.chainStatus, "not_provided");
assert.equal(walletless.networkMode, "testnet");
assert.equal(walletless.address, undefined);

console.log("Turn context checks passed.");
