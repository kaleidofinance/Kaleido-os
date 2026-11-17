import { ethers } from "ethers";
import type { SynthraPoolLeg } from "./synthraPoolSafety";
import { isSynthraInternalRouter } from "./synthraDeployments";

const MULTICALL = new ethers.Interface([
  "function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
]);

/** Decode the documented exact-input SwapRouter02 shape on Synthra's internal
 * deployments. Both direct exactInput and deadline-wrapped multicall are
 * accepted; no other router method is admitted. */
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
    if (!isSynthraInternalRouter(input.chainId, input.to)) return false;
    const exact = (data: string) =>
      MULTICALL.decodeFunctionData("exactInput", data)[0];
    const parsed = new ethers.Interface([
      "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns(uint256 amountOut)",
      "function multicall(uint256 deadline,bytes[] data) payable returns(bytes[] results)",
    ]).parseTransaction({ data: input.data });
    if (!parsed) return false;
    let params: any;
    if (parsed.name === "exactInput") {
      params = parsed.args[0];
    } else if (parsed.name === "multicall") {
      const deadline = parsed.args[0] as bigint;
      const calls = parsed.args[1] as string[];
      if (
        deadline <= BigInt(input.nowSeconds ?? Math.floor(Date.now() / 1000)) ||
        calls.length !== 1
      )
        return false;
      params = exact(calls[0]);
    } else {
      return false;
    }
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
