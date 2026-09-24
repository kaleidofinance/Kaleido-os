import { AbiCoder, Interface, getAddress } from "ethers";
import { ARGUS_V4, ARGUS_POOL_FEE, ARGUS_TICK_SPACING, PERMIT2, argusEnabled } from "./addresses";
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
// Takes a bps portion of the settled output to a recipient, in the SAME swap tx —
// the aggregator-style fee. Confirmed supported on Argus's (older) Arc router by a
// read-only action-dispatch probe (an unknown action reverts UnsupportedAction; this
// one dispatches). 2026-09-24.
const ACTION_TAKE_PORTION = "10";
const COMMAND_V4_SWAP = "10";
// UniversalRouter command: Permit2.transferFrom(msg.sender → recipient). Used to
// take a BUY's fee from the USDC input inside the same execute() as the swap —
// the input-side twin of TAKE_PORTION. Confirmed dispatched on Argus's Arc router
// by a read-only probe (reached Permit2 → AllowanceExpired, while an invalid
// command reverts InvalidCommandType). 2026-09-24.
const COMMAND_PERMIT2_TRANSFER_FROM = "02";

/** Canonical Permit2 — defined in ./addresses, re-exported for existing callers. */
export { PERMIT2 };

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
    /** In-swap fee taken from the output, if any (bps + recipient). */
    feeBps: number;
    feeReceiver: string | null;
    /** In-tx fee pulled from the INPUT via PERMIT2_TRANSFER_FROM (buys), raw units. */
    inputFeeRaw: bigint;
  };
  unverified: true;
}

export function buildArgusSwapTx(params: {
  launch: ArgusLaunch;
  side: "buy" | "sell";
  /** Input amount in smallest units (quote units for buy, token units for sell). */
  amountInRaw: bigint;
  /** Minimum acceptable TOTAL output in smallest units — from the quoter ×
   *  (1 − slippage). The ONLY on-chain protection against price impact + tax, so
   *  it must never be 0 for a real trade. When a fee is taken, the user's own
   *  floor is this minus the fee (computed below); this stays the whole-swap min. */
  amountOutMinimum: bigint;
  /** Optional in-swap fee: take `bps` of the OUTPUT to `receiver` via TAKE_PORTION,
   *  the rest to the user via TAKE_ALL — one transaction, aggregator-style. Used
   *  for sells (fee in USDC out). Omitted → the verified plain SWAP→SETTLE→TAKE_ALL
   *  path (buys skim their fee from the USDC input instead), byte-identical to before. */
  fee?: { receiver: string; bps: number };
  /** Optional fee taken from the INPUT in the same transaction: a
   *  PERMIT2_TRANSFER_FROM of `amountRaw` of the input currency to `receiver`,
   *  ahead of the V4_SWAP. Used for buys (fee in USDC in), so the fee is part of
   *  the one swap transaction rather than a separate transfer step. The Permit2
   *  allowance must cover amountInRaw + amountRaw. */
  inputFee?: { receiver: string; amountRaw: bigint };
  deadlineSec?: number;
}): ArgusSwapTx | null {
  if (!argusEnabled()) return null;
  const { launch, side, amountInRaw, amountOutMinimum } = params;
  if (amountInRaw <= 0n) return null;
  const feeBps = params.fee && params.fee.bps > 0 ? params.fee.bps : 0;
  const feeReceiver = feeBps > 0 ? getAddress(params.fee!.receiver) : null;

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

  // With a fee, split the output: TAKE_PORTION(fee → receiver) then TAKE_ALL(rest →
  // user). Without, the plain single TAKE_ALL — byte-identical to the verified path.
  const actions =
    "0x" +
    ACTION_SWAP_EXACT_IN_SINGLE +
    ACTION_SETTLE_ALL +
    (feeReceiver ? ACTION_TAKE_PORTION : "") +
    ACTION_TAKE_ALL;

  // Argus's DEPLOYED v4 router (Arc) is an older build whose ExactInputSingleParams
  // still carries `sqrtPriceLimitX96` (uint160) between amountOutMinimum and
  // hookData. Omitting it makes the router mis-decode the tail and revert bare.
  // Verified 2026-09-23 by byte-diffing a real successful swap + estimateGas.
  // 0 = no price limit (single-range fill; slippage is enforced by minOut/TAKE_ALL).
  const swapParam = coder.encode(
    [
      "tuple(tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint160 sqrtPriceLimitX96,bytes hookData)",
    ],
    [[[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks], zeroForOne, amountInRaw, amountOutMinimum, 0n, "0x"]],
  );
  const settleParam = coder.encode(["address", "uint256"], [inputCurrency, amountInRaw]);
  // TAKE_ALL's floor is what the USER must receive. With a fee that is the whole-swap
  // min minus the fee's cut of it, so a real trade still can't slip below its floor.
  const userMinOut = feeBps > 0
    ? (amountOutMinimum * BigInt(10_000 - feeBps)) / 10_000n
    : amountOutMinimum;
  const takeParams = feeReceiver
    ? [
        coder.encode(["address", "address", "uint256"], [outputCurrency, feeReceiver, BigInt(feeBps)]),
        coder.encode(["address", "uint256"], [outputCurrency, userMinOut]),
      ]
    : [coder.encode(["address", "uint256"], [outputCurrency, userMinOut])];

  const v4Input = coder.encode(["bytes", "bytes[]"], [actions, [swapParam, settleParam, ...takeParams]]);
  const deadline = params.deadlineSec ?? Math.floor(Date.now() / 1000) + 600;

  // An input-side fee rides as a first command: Permit2 pulls it from the user to
  // the receiver, then V4_SWAP runs on the rest. Without one, the command list is
  // the verified single V4_SWAP, byte-identical to before.
  const inputFeeRaw =
    params.inputFee && params.inputFee.amountRaw > 0n ? params.inputFee.amountRaw : 0n;
  const commands =
    "0x" + (inputFeeRaw > 0n ? COMMAND_PERMIT2_TRANSFER_FROM : "") + COMMAND_V4_SWAP;
  const inputs =
    inputFeeRaw > 0n
      ? [
          coder.encode(
            ["address", "address", "uint160"],
            [inputCurrency, getAddress(params.inputFee!.receiver), inputFeeRaw],
          ),
          v4Input,
        ]
      : [v4Input];
  const data = routerIface.encodeFunctionData("execute", [commands, inputs, deadline]);

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
      feeBps,
      feeReceiver,
      inputFeeRaw,
    },
    unverified: true,
  };
}
