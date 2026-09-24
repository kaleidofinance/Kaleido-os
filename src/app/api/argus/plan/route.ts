import { Contract, getAddress } from "ethers";
import { providerForChain } from "@/config/provider";
import { swapFeeReceiver } from "@/lib/swap/kyberswapServer";
import {
  ARGUS_CHAIN_ID,
  ARC_USDC,
  ARC_USDC_DECIMALS,
  argusEnabled,
} from "@/lib/argus/addresses";
import { readArgusLaunch, readArgusPoolState } from "@/lib/argus/launch";
import { quoteArgusSwap } from "@/lib/argus/quoter";
import { buildArgusSwapTx } from "@/lib/argus/swap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-built plan for an Argus-launchpad BUY (USDC → launch token, direct v4).
 *
 * Server-side because it (a) reads the launch + pool over RPC, (b) applies the
 * Kaleido fee whose receiver (`SWAP_FEE_RECEIVER`) is a SERVER-only env, and
 * (c) builds the UniversalRouter calldata. buildIntents (client) calls this via
 * the injected `argusPlan` dep and assembles the signable steps. Pilot scope:
 * BUYS only, and only when the input is Arc USDC. Returns `{argus:false}` when
 * the output isn't an Argus launch, so the caller falls through to its normal
 * swap path. Inert unless ARGUS_ENABLED.
 */

/** Kaleido's fee on an Argus trade, in bps. Skimmed from the USDC input. */
const KALEIDO_FEE_BPS = 20; // 0.2%

const ERC20 = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];

export async function POST(req: Request) {
  if (!argusEnabled()) return Response.json({ argus: false, reason: "disabled" });
  let body: { tokenIn?: string; tokenOut?: string; amountInRaw?: string; slippageBps?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }
  const { tokenIn, tokenOut, amountInRaw, slippageBps } = body;
  if (!tokenIn || !tokenOut || !amountInRaw) {
    return Response.json({ error: "tokenIn, tokenOut, amountInRaw required" }, { status: 400 });
  }
  // Pilot: buys only. The input must be Arc USDC (the quote asset).
  if (getAddress(tokenIn).toLowerCase() !== ARC_USDC.toLowerCase()) {
    return Response.json({ argus: false, reason: "not a USDC-in buy" });
  }
  let amountIn: bigint;
  try {
    amountIn = BigInt(amountInRaw);
  } catch {
    return Response.json({ error: "amountInRaw not an integer" }, { status: 400 });
  }
  if (amountIn <= 0n) return Response.json({ error: "amountInRaw must be positive" }, { status: 400 });

  const launch = await readArgusLaunch(tokenOut);
  if (!launch) return Response.json({ argus: false, reason: "not an Argus launch" });
  const state = await readArgusPoolState(launch);
  if (!state) return Response.json({ argus: false, reason: "pool state unavailable" });

  // Fee: skim from the USDC input (server-only receiver). No receiver → no fee.
  const feeReceiver = swapFeeReceiver() ?? null;
  const feeAmount = feeReceiver ? (amountIn * BigInt(KALEIDO_FEE_BPS)) / 10_000n : 0n;
  const swapAmount = amountIn - feeAmount;
  if (swapAmount <= 0n) return Response.json({ error: "amount too small after fee" }, { status: 400 });

  const provider = providerForChain(ARGUS_CHAIN_ID);
  if (!provider) return Response.json({ error: "no provider" }, { status: 503 });
  let tokenDecimals = 18;
  let tokenSymbol = tokenOut.slice(0, 6) + "…";
  try {
    const erc = new Contract(launch.token, ERC20, provider);
    tokenDecimals = Number(await erc.decimals());
    tokenSymbol = String(await erc.symbol());
  } catch {
    /* keep the fallbacks — the swap still works, the row is just less pretty */
  }

  const quote = quoteArgusSwap({
    launch,
    state,
    side: "buy",
    amountInRaw: swapAmount,
    tokenDecimals,
    quoteDecimals: ARC_USDC_DECIMALS,
  });
  if (!quote || !(quote.amountOut > 0)) {
    return Response.json({ argus: false, reason: "no quote (illiquid or read error)" });
  }
  if (quote.snipeBlocked) {
    return Response.json({ argus: true, blocked: true, reason: `opening surcharge active (${state.snipeBps}bps) — trading is blocked for the first seconds of the launch` });
  }
  if (quote.exhaustsRange) {
    // The whole supply is one v4 position; a buy this large walks price past its
    // upper bound, where the single-range estimate over-states fill and the
    // derived min-out would be unsafe. Refuse rather than quote a wrong number.
    return Response.json({ argus: true, blocked: true, reason: "trade too large for this pool's single-range liquidity — try a smaller size" });
  }

  const slip = BigInt(Math.max(1, Math.min(slippageBps ?? 200, 5000)));
  const outRaw = BigInt(Math.floor(quote.amountOut * 10 ** tokenDecimals));
  const amountOutMinimum = (outRaw * (10_000n - slip)) / 10_000n;
  if (amountOutMinimum <= 0n) return Response.json({ error: "min-out is zero" }, { status: 400 });

  const swap = buildArgusSwapTx({ launch, side: "buy", amountInRaw: swapAmount, amountOutMinimum });
  if (!swap) return Response.json({ error: "swap build failed" }, { status: 500 });

  return Response.json({
    argus: true,
    blocked: false,
    tokenOut: { address: launch.token, symbol: tokenSymbol, decimals: tokenDecimals },
    fee: { receiver: feeReceiver, amountRaw: feeAmount.toString(), bps: feeReceiver ? KALEIDO_FEE_BPS : 0 },
    swapAmountRaw: swapAmount.toString(),
    to: swap.to,
    data: swap.data,
    value: swap.value.toString(),
    hook: launch.hook,
    amountOut: quote.amountOut,
    amountOutMinimum: amountOutMinimum.toString(),
    priceImpactBps: quote.priceImpactBps,
    totalCostBps: quote.totalCostBps,
  });
}
