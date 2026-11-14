import { ethers } from "ethers";
import type { SynthraPoolLeg } from "./synthraPoolSafety";

const MULTICALL = new ethers.Interface([
  "function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
]);

/** Decode only the single exact-input SwapRouter02 shape inspected on Elysium. */
export function verifySynthraInternalCall(input: {
  chainId: number;
  to: string;
  data: string;
  value: string;
  wallet: string;
  amountIn: string;
  minimumOut: string;
  nativeInput: boolean;
  legs: SynthraPoolLeg[];
  nowSeconds?: number;
}): boolean {
  try {
    if (
      input.chainId !== 99901 ||
      input.to.toLowerCase() !== "0xa50ede66a573ee5bb37e28af5789b76ae5feb828"
    )
      return false;
    const [deadline, calls] = MULTICALL.decodeFunctionData(
      "multicall",
      input.data,
    );
    if (
      deadline <= BigInt(input.nowSeconds ?? Math.floor(Date.now() / 1000)) ||
      calls.length !== 1
    )
      return false;
    const [params] = MULTICALL.decodeFunctionData("exactInput", calls[0]);
    if (
      params.recipient.toLowerCase() !== input.wallet.toLowerCase() ||
      params.amountIn !== BigInt(input.amountIn) ||
      params.amountOutMinimum < BigInt(input.minimumOut)
    )
      return false;
    if (
      BigInt(input.value) !== (input.nativeInput ? BigInt(input.amountIn) : 0n)
    )
      return false;
    if (input.legs.length < 1 || input.legs.length > 3) return false;
    const expectedPath = ethers.solidityPacked(
      ["address", ...input.legs.flatMap(() => ["uint24", "address"])],
      [
        input.legs[0].tokenIn.address,
        ...input.legs.flatMap((leg) => [leg.fee, leg.tokenOut.address]),
      ],
    );
    return params.path.toLowerCase() === expectedPath.toLowerCase();
  } catch {
    return false;
  }
}
