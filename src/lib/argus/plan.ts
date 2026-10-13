import { Interface, getAddress, MaxUint256 } from "ethers";
import { argusEnabled } from "./addresses";
import { isSnipeWindow } from "./poolMath";
import { buildArgusSwapTx, PERMIT2, type ArgusSwapTx } from "./swap";
import type { ArgusLaunch, ArgusPoolState } from "./launch";
import { quoteArgusSwap, type ArgusQuote } from "./quoter";

/**
 * Assemble the full ordered transaction plan Luca would sign to buy/sell an
 * Argus launch token: the Permit2 approvals the UniversalRouter needs, then the
 * v4 swap. Executor-agnostic ({to,data,value,label}[]) so the agent can adopt it
 * later without this module knowing about the intent/auditor layer.
 *
 * This is Phase 4a. It does NOT wire into Luca's grammar/auditor/executor and does
 * NOT sign anything — and it must not, until (1) the swap builder is verified by a
 * real on-chain swap (it is marked `unverified`), and (2) the agent-execution
 * sign-off gate is cleared. Gated by ARGUS_ENABLED; returns a blocked plan inside
 * the snipe window.
 *
 * SAFETY: `amountOutMinimum` derived here (quote × (1 − slippage)) is the only
 * on-chain protection against price impact + the hook tax, so a plan with no/zero
 * min-out is never executable — we refuse it.
 */

const erc20 = new Interface(["function approve(address spender, uint256 amount) returns (bool)"]);
// Permit2's allowance-style approve (uint160 amount, uint48 expiration).
const permit2 = new Interface(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);

export interface PlanStep {
  to: string;
  data: string;
  value: bigint;
  /** Human label for plan display / auditing. */
  label: string;
  kind: "approve-erc20" | "approve-permit2" | "swap";
}

export interface ArgusTradePlan {
  ok: boolean;
  /** Set when ok=false — why the plan can't proceed (e.g. snipe window). */
  reason?: string;
  side: "buy" | "sell";
  quote: ArgusQuote | null;
  amountInRaw: bigint;
  amountOutMinimum: bigint;
  slippageBps: number;
  /** Kaleido's own fee applied to this trade, in bps. Default 0 for Argus. */
  kaleidoFeeBps: number;
  steps: PlanStep[];
  /** The swap tx (also the last step) with its meta, for the auditor/UI. */
  swap: ArgusSwapTx | null;
  /** Carried through until a real on-chain swap verifies the encoding. */
  unverified: true;
}

const DEFAULT_SLIPPAGE_BPS = 200; // 2% — thin, fast-moving launch pools
const APPROVAL_EXPIRY_SECONDS = 30 * 60;

export function buildArgusTradePlan(params: {
  wallet: string;
  launch: ArgusLaunch;
  state: ArgusPoolState;
  side: "buy" | "sell";
  amountInRaw: bigint;
  tokenDecimals: number;
  quoteDecimals: number;
  /** Default 2%. */
  slippageBps?: number;
  /** Kaleido's fee on Argus trades. Default 0 — we don't stack on the 1–10%
   *  launch tax; the pitch is that we're additive to Argus's economics. */
  kaleidoFeeBps?: number;
}): ArgusTradePlan | null {
  if (!argusEnabled()) return null;
  const {
    wallet, launch, state, side, amountInRaw, tokenDecimals, quoteDecimals,
  } = params;
  const slippageBps = params.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const kaleidoFeeBps = params.kaleidoFeeBps ?? 0;

  const base = {
    side, amountInRaw, slippageBps, kaleidoFeeBps,
    quote: null as ArgusQuote | null, swap: null as ArgusSwapTx | null,
    steps: [] as PlanStep[], amountOutMinimum: 0n, unverified: true as const,
  };

  // Refuse inside the opening surcharge window — a trade here can pay ~99%.
  if (isSnipeWindow(state.snipeBps)) {
    return { ...base, ok: false, reason: `snipe window active (${state.snipeBps}bps) — trading blocked for the first seconds of the launch` };
  }

  const quote = quoteArgusSwap({ launch, state, side, amountInRaw, tokenDecimals, quoteDecimals });
  if (!quote || !(quote.amountOut > 0)) {
    return { ...base, ok: false, reason: "no quote (illiquid pool or read failure)" };
  }

  // Min-out in raw output units, from the estimate minus slippage.
  const outDecimals = side === "buy" ? tokenDecimals : quoteDecimals;
  const outRaw = BigInt(Math.floor(quote.amountOut * 10 ** outDecimals));
  const amountOutMinimum = (outRaw * BigInt(10_000 - slippageBps)) / 10_000n;
  if (amountOutMinimum <= 0n) {
    return { ...base, ok: false, reason: "computed min-out is zero — refusing an unprotected trade" };
  }

  const swap = buildArgusSwapTx({ launch, side, amountInRaw, amountOutMinimum });
  if (!swap) return { ...base, ok: false, reason: "swap build failed" };

  // The UniversalRouter pulls the input via Permit2: ERC-20 approve the input to
  // Permit2, then Permit2-approve the router. (A production path may swap step 2
  // for a signed PermitSingle; kept as an on-chain approve here for a plain plan.)
  const inputToken = getAddress(swap.meta.inputCurrency);
  const router = getAddress(swap.to);
  const expiration = Math.floor(Date.now() / 1000) + APPROVAL_EXPIRY_SECONDS;
  const steps: PlanStep[] = [
    {
      kind: "approve-erc20",
      to: inputToken,
      data: erc20.encodeFunctionData("approve", [PERMIT2, MaxUint256]),
      value: 0n,
      label: `Approve Permit2 to spend ${side === "buy" ? "USDC" : "the token"}`,
    },
    {
      kind: "approve-permit2",
      to: getAddress(PERMIT2),
      data: permit2.encodeFunctionData("approve", [inputToken, router, amountInRaw, expiration]),
      value: 0n,
      label: "Authorize the UniversalRouter on Permit2",
    },
    { kind: "swap", to: swap.to, data: swap.data, value: swap.value, label: `${side === "buy" ? "Buy" : "Sell"} via Uniswap v4 (Argus)` },
  ];
  void wallet; // reserved: a production path checks existing allowances to skip steps

  return {
    ...base,
    ok: true,
    quote,
    amountOutMinimum,
    swap,
    steps,
  };
}
