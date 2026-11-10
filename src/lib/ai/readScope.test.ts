import assert from "node:assert/strict";
import { resolveReadChain } from "./readTools";

const connectedArc = 5042;

const namedBsc = resolveReadChain(
  "getBalances",
  { address: "0x0000000000000000000000000000000000000001", targetChain: "BSC" },
  connectedArc,
  "mainnet",
);
assert.deepEqual(namedBsc, { chainId: 56 });

const namedById = resolveReadChain("getPortfolio", { targetChain: "99901" }, connectedArc, "mainnet");
assert.deepEqual(namedById, { chainId: 99901 });

const loanOnBsc = resolveReadChain("getLoans", { targetChain: "BSC" }, connectedArc, "mainnet");
assert.deepEqual(loanOnBsc, { chainId: 56 });

const positionsOnRobinhood = resolveReadChain(
  "getPositions",
  { targetChain: "Robinhood Chain" },
  connectedArc,
  "mainnet",
);
assert.deepEqual(positionsOnRobinhood, { chainId: 4663 });

const testnetInMainnetMode = resolveReadChain(
  "getBalances",
  { targetChain: 99801 },
  connectedArc,
  "mainnet",
);
assert.equal(testnetInMainnetMode.chainId, connectedArc);
assert.match(testnetInMainnetMode.error ?? "", /different network mode|testnet/i);

const unknown = resolveReadChain(
  "getBalances",
  { targetChain: "not-a-chain" },
  connectedArc,
  "mainnet",
);
assert.equal(unknown.chainId, connectedArc);
assert.match(unknown.error ?? "", /not in Kaleido's registry/i);

const actionReadDoesNotOverride = resolveReadChain(
  "getSwapRoute",
  { targetChain: "BSC" },
  connectedArc,
  "mainnet",
);
assert.deepEqual(actionReadDoesNotOverride, { chainId: connectedArc });

console.log("Read scope checks passed.");
