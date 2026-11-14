import assert from "node:assert/strict";
import { ethers } from "ethers";
import { verifySynthraInternalCall } from "./synthraInternalCall";

const a = "0x1111111111111111111111111111111111111111";
const b = "0x2222222222222222222222222222222222222222";
const p = "0x3333333333333333333333333333333333333333";
const leg = {
  pool: p,
  fee: 500,
  tokenIn: { address: a, chainId: 99901 },
  tokenOut: { address: b, chainId: 99901 },
};
const iface = new ethers.Interface([
  "function multicall(uint256 deadline,bytes[] data) payable returns(bytes[])",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns(uint256)",
]);
const path = ethers.solidityPacked(
  ["address", "uint24", "address"],
  [a, 500, b],
);
const call = iface.encodeFunctionData("exactInput", [[path, a, 100n, 90n]]);
const base = {
  chainId: 99901,
  to: "0xa50eDe66a573eE5eB37E28AF5789B76aE5FEb828",
  data: iface.encodeFunctionData("multicall", [2000, [call]]),
  value: "100",
  wallet: a,
  amountIn: "100",
  minimumOut: "90",
  nativeInput: true,
  legs: [leg],
  nowSeconds: 1000,
};
// Correct checksummed spelling is immaterial to the comparison.
base.to = "0xa50ede66a573ee5bb37e28af5789b76ae5feb828";
assert.equal(verifySynthraInternalCall(base), true);
assert.equal(verifySynthraInternalCall({ ...base, nowSeconds: 2000 }), false);
assert.equal(verifySynthraInternalCall({ ...base, minimumOut: "91" }), false);
assert.equal(
  verifySynthraInternalCall({ ...base, legs: [{ ...leg, fee: 3000 }] }),
  false,
);
assert.equal(verifySynthraInternalCall({ ...base, wallet: b }), false);
console.log("Synthra internal calldata checks passed");
