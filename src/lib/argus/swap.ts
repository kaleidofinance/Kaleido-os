import { AbiCoder, Interface, getAddress } from "ethers";
import { ARGUS_V4, ARGUS_POOL_FEE, ARGUS_TICK_SPACING, argusEnabled } from "./addresses";
import { swapDirection } from "./poolMath";
import type { ArgusLaunch } from "./launch";

/**
 * Build the UniversalRouter calldata for a Uniswap-v4 exact-input swap of an
 * Argus launch token (buy = quote→token, sell = token→quote).
 *
 * The encoding is reverse-engineered from a REAL v4 swap on Arc (2026-09-23), not
 * assumed: `execute(commands, inputs, deadline)` with commands = 0x10 (V4_SWAP)
 * and a single input carrying the v4 action sequence
 *   0x06 SWAP_EXACT_IN_SINGLE → 0x0c SETTLE_ALL → 0x0f TAKE_ALL
 * with params [ExactInputSingleParams, (inCurrency, amountIn), (outCurrency, minOut)].
 *
 * ⚠️ UNVERIFIED END-TO-END: the structure matches a live swap and the calldata
 * decodes back exactly (see swap.test.ts), but this has NOT been executed on-chain
 * with real funds. Do NOT enable for signing until a testnet/small-size mainnet
 * swap confirms it. Gated by ARGUS_ENABLED (off) so nothing can sign it yet.
 *
 * PREREQUISITE (caller's responsibility): the UniversalRouter pulls the input via
 * Permit2. Before this swap the wallet must have (1) approved the input token to
 * the canonical Permit2, and (2) a Permit2 allowance for the UniversalRouter — or
 * a PERMIT2_PERMIT command must be prepended with a signed permit. This builder
 * emits only the swap; wire approvals in the Luca plan (Phase 4).
 */

// v4 Actions (Uniswap v4 periphery). Named so a spec change is a one-line fix.
const ACTION_SWAP_EXACT_IN_SINGLE = "06";
const ACTION_SETTLE_ALL = "0c";
const ACTION_TAKE_ALL = "0f";
const COMMAND_V4_SWAP = "0x10";

/** Canonical Permit2 (same address across chains). Verify on Arc before enabling. */
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const routerIface = new Interface([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
]);
const coder = AbiCoder.defaultAbiCoder();

export interface ArgusSwapTx {
  to: string;
  data: string;
  value: bigint;
  /** Echoes the decision inputs for auditing/plan display. */
  meta: {
    side: "buy" | "sell";
    zeroForOne: boolean;
    inputCurrency: string;
    outputCurrency: string;
    amountIn: bigint;
    amountOutMinimum: bigint;
    poolFee: number;
    hook: string;
    deadline: number;
    /** The input token that must have a Permit2 → UniversalRouter allowance. */
    approvalNeededFor: string;
  };
  unverified: true;
}

export function buildArgusSwapTx(params: {
  launch: ArgusLaunch;
  side: "buy" | "sell";
  /** Input amount in smallest units (quote units for buy, token units for sell). */
  amountInRaw: bigint;
  /** Minimum acceptable output in smallest units — from the quoter × (1 − slippage).
   *  This is the ONLY on-chain protection against price impact + tax, so it must
   *  never be left at 0 for a real trade. */
  amountOutMinimum: bigint;
  deadlineSec?: number;
}): ArgusSwapTx | null {
  if (!argusEnabled()) return null;
  const { launch, side, amountInRaw, amountOutMinimum } = params;
  if (amountInRaw <= 0n) return null;

  const { zeroForOne } = swapDirection(side, launch.tokenIsToken0);
  const fee = launch.poolFee ?? ARGUS_POOL_FEE;
  const poolKey = {
    currency0: getAddress(launch.currency0),
    currency1: getAddress(launch.currency1),
    fee,
    tickSpacing: ARGUS_TICK_SPACING,
    hooks: getAddress(launch.hook),
  };
  // Input currency is the one flowing INTO the pool; output is the other.
  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;

  const actions = "0x" + ACTION_SWAP_EXACT_IN_SINGLE + ACTION_SETTLE_ALL + ACTION_TAKE_ALL;

  const swapParam = coder.encode(
    [
      "tuple(tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)",
    ],
    [[[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks], zeroForOne, amountInRaw, amountOutMinimum, "0x"]],
  );
  const settleParam = coder.encode(["address", "uint256"], [inputCurrency, amountInRaw]);
  const takeParam = coder.encode(["address", "uint256"], [outputCurrency, amountOutMinimum]);

  const v4Input = coder.encode(["bytes", "bytes[]"], [actions, [swapParam, settleParam, takeParam]]);
  const deadline = params.deadlineSec ?? Math.floor(Date.now() / 1000) + 600;
  const data = routerIface.encodeFunctionData("execute", [COMMAND_V4_SWAP, [v4Input], deadline]);

  return {
    to: getAddress(ARGUS_V4.universalRouter),
    data,
    value: 0n, // Arc's quote is ERC-20 USDC (0x3600…), not native — pulled via Permit2.
    meta: {
      side,
      zeroForOne,
      inputCurrency,
      outputCurrency,
      amountIn: amountInRaw,
      amountOutMinimum,
      poolFee: fee,
      hook: poolKey.hooks,
      deadline,
      approvalNeededFor: inputCurrency,
    },
    unverified: true,
  };
}
