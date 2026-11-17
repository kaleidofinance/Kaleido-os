import { ethers } from "ethers";
import { isKnownSwapRouter } from "./kyberswap";
import type { SynthraTransaction } from "./synthraSteps";

// Kyber MetaAggregationRouterV2 swap(SwapExecutionParams), selector 0xe21fd0e9.
const ROUTER = new ethers.Interface([
  "function swap((address callTarget,address approveTarget,bytes targetData,(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes clientData) execution) payable returns (uint256,uint256)",
]);
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const ZERO = ethers.ZeroAddress.toLowerCase();

/** Checks the reviewed bounds inside Kyber calldata. This does not certify the
 * underlying liquidity pools or authorize execution of arbitrary steps. */
export function validateSynthraKyberCall(
  tx: SynthraTransaction,
  expected: {
    wallet: string;
    chainId: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    minimumAmountOut: string;
  },
): boolean {
  try {
    if (
      tx.chainId !== expected.chainId ||
      !isKnownSwapRouter(expected.chainId, tx.to) ||
      tx.from.toLowerCase() !== expected.wallet.toLowerCase()
    )
      return false;
    const [execution] = ROUTER.decodeFunctionData("swap", tx.data);
    const desc = execution.desc;
    const token = (address: string) =>
      address.toLowerCase() === ZERO ? NATIVE : address.toLowerCase();
    const native = token(expected.tokenIn) === NATIVE;
    if (
      token(desc.srcToken) !== token(expected.tokenIn) ||
      token(desc.dstToken) !== token(expected.tokenOut) ||
      desc.dstReceiver.toLowerCase() !== expected.wallet.toLowerCase()
    )
      return false;
    if (
      desc.amount !== BigInt(expected.amountIn) ||
      desc.minReturnAmount < BigInt(expected.minimumAmountOut) ||
      desc.permit !== "0x"
    )
      return false;
    return BigInt(tx.value) === (native ? BigInt(expected.amountIn) : 0n);
  } catch {
    return false;
  }
}
