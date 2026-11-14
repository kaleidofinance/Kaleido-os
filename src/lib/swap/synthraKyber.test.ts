import assert from "node:assert/strict";
import { ethers } from "ethers";
import { validateSynthraKyberCall } from "./synthraKyber";

const wallet = "0x1111111111111111111111111111111111111111";
const token = "0x2222222222222222222222222222222222222222";
const router = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
const iface = new ethers.Interface([
  "function swap((address callTarget,address approveTarget,bytes targetData,(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes clientData) execution) payable returns (uint256,uint256)",
]);
const data = iface.encodeFunctionData("swap", [
  [
    wallet,
    router,
    "0x",
    [ethers.ZeroAddress, token, [], [], [], [], wallet, 100n, 90n, 0n, "0x"],
    "0x",
  ],
]);
const tx = { from: wallet, to: router, data, value: "100", chainId: 99901 };
const expected = {
  wallet,
  chainId: 99901,
  tokenIn: ethers.ZeroAddress,
  tokenOut: token,
  amountIn: "100",
  minimumAmountOut: "90",
};
assert.equal(validateSynthraKyberCall(tx, expected), true);
assert.equal(
  validateSynthraKyberCall(tx, { ...expected, minimumAmountOut: "91" }),
  false,
);
assert.equal(
  validateSynthraKyberCall(tx, { ...expected, wallet: token }),
  false,
);
assert.equal(
  validateSynthraKyberCall({ ...tx, value: "101" }, expected),
  false,
);
assert.equal(validateSynthraKyberCall({ ...tx, to: token }, expected), false);
console.log("Synthra Kyber calldata checks passed");
