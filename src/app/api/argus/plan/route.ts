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
 * Server-built plan for an Argus-launchpad trade (direct Uniswap v4).
 *
 * Server-side because it (a) reads the launch + pool over RPC, (b) applies the
 * Kaleido fee whose receiver (`SWAP_FEE_RECEIVER`) is a SERVER-only env, and
 * (c) builds the UniversalRouter calldata. buildIntents (client) calls this via
 * the injected `argusPlan` dep and assembles the signable steps.
 *
 * Both sides take the fee INSIDE the one swap transaction, aggregator-style — never
 * as a step of its own. BUY (USDC → launch token): a PERMIT2_TRANSFER_FROM command
 * pulls the fee from the USDC input ahead of the V4_SWAP. SELL (launch token →
 * USDC): the USDC only exists after the swap, so TAKE_PORTION takes it from the
 * output. The older Arc router supports both (probed 2026-09-24).
 * USDC must be one side, or we return `{argus:false}` and the caller routes normally.
 * Inert unless ARGUS_ENABLED.
 */

/** Kaleido's fee on an Argus trade, in bps (0.2%). */
const KALEIDO_FEE_BPS = 20;

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

  // USDC must be exactly one side: USDC-in is a buy, USDC-out is a sell.
  const usdc = ARC_USDC.toLowerCase();
  const inIsUsdc = getAddress(tokenIn).toLowerCase() === usdc;
  const outIsUsdc = getAddress(tokenOut).toLowerCase() === usdc;
  if (inIsUsdc === outIsUsdc) {
    return Response.json({ argus: false, reason: "one side must be Arc USDC" });
  }
  const side: "buy" | "sell" = inIsUsdc ? "buy" : "sell";
  const launchTokenAddr = inIsUsdc ? tokenOut : tokenIn;

  let amountIn: bigint;
  try {
    amountIn = BigInt(amountInRaw);
  } catch {
    return Response.json({ error: "amountInRaw not an integer" }, { status: 400 });
  }
  if (amountIn <= 0n) return Response.json({ error: "amountInRaw must be positive" }, { status: 400 });

  const launch = await readArgusLaunch(launchTokenAddr);
  if (!launch) return Response.json({ argus: false, reason: "not an Argus launch" });
  const state = await readArgusPoolState(launch);
  if (!state) return Response.json({ argus: false, reason: "pool state unavailable" });

  const provider = providerForChain(ARGUS_CHAIN_ID);
  if (!provider) return Response.json({ error: "no provider" }, { status: 503 });
  let tokenDecimals = 18;
  let tokenSymbol = launch.token.slice(0, 6) + "…";
  try {
    const erc = new Contract(launch.token, ERC20, provider);
    tokenDecimals = Number(await erc.decimals());
    tokenSymbol = String(await erc.symbol());
  } catch {
    /* keep the fallbacks — the swap still works, the row is just less pretty */
  }
  const tokenInfo = { address: launch.token, symbol: tokenSymbol, decimals: tokenDecimals };
  const feeReceiver = swapFeeReceiver() ?? null;
  const feeBps = feeReceiver ? KALEIDO_FEE_BPS : 0;
  const slip = BigInt(Math.max(1, Math.min(slippageBps ?? 200, 5000)));

  /* Guards shared by both sides. `quote` is re-run per side below with the right
     amount, but the block cases (snipe window, single-range exhaustion) read the
     same way and are handled once at the call sites. */

  if (side === "buy") {
    // Fee taken from the USDC input in the same tx (PERMIT2_TRANSFER_FROM); swap the rest.
    const feeAmount = (amountIn * BigInt(feeBps)) / 10_000n;
    const swapAmount = amountIn - feeAmount;
    if (swapAmount <= 0n) return Response.json({ error: "amount too small after fee" }, { status: 400 });

    const quote = quoteArgusSwap({
      launch, state, side: "buy", amountInRaw: swapAmount, tokenDecimals, quoteDecimals: ARC_USDC_DECIMALS,
    });
    if (!quote || !(quote.amountOut > 0)) return Response.json({ argus: false, reason: "no quote (illiquid or read error)" });
    if (quote.snipeBlocked) return Response.json({ argus: true, blocked: true, reason: `opening surcharge active (${state.snipeBps}bps) — trading is blocked for the first seconds of the launch` });
    if (quote.exhaustsRange) return Response.json({ argus: true, blocked: true, reason: "trade too large for this pool's single-range liquidity — try a smaller size" });

    const outRaw = BigInt(Math.floor(quote.amountOut * 10 ** tokenDecimals));
    const amountOutMinimum = (outRaw * (10_000n - slip)) / 10_000n;
    if (amountOutMinimum <= 0n) return Response.json({ error: "min-out is zero" }, { status: 400 });

    const swap = buildArgusSwapTx({
      launch, side: "buy", amountInRaw: swapAmount, amountOutMinimum,
      ...(feeReceiver && feeAmount > 0n ? { inputFee: { receiver: feeReceiver, amountRaw: feeAmount } } : {}),
    });
    if (!swap) return Response.json({ error: "swap build failed" }, { status: 500 });

    return Response.json({
      argus: true, blocked: false, side: "buy",
      tokenOut: tokenInfo,
      fee: { receiver: feeReceiver, amountRaw: feeAmount.toString(), bps: feeBps, inSwap: true },
      swapAmountRaw: swapAmount.toString(),
      // What Permit2 must let the router pull: the swap plus the in-tx fee.
      totalInRaw: amountIn.toString(),
      to: swap.to, data: swap.data, value: swap.value.toString(), hook: launch.hook,
      amountOut: quote.amountOut,
      amountOutMinimum: amountOutMinimum.toString(),
      priceImpactBps: quote.priceImpactBps, totalCostBps: quote.totalCostBps,
    });
  }

  // SELL: input is the launch token, output is USDC. The whole token amount is
  // swapped; the fee is taken in-swap from the USDC output (TAKE_PORTION), so no
  // pre-swap transfer and no reduction of the input.
  const quote = quoteArgusSwap({
    launch, state, side: "sell", amountInRaw: amountIn, tokenDecimals, quoteDecimals: ARC_USDC_DECIMALS,
  });
  if (!quote || !(quote.amountOut > 0)) return Response.json({ argus: false, reason: "no quote (illiquid or read error)" });
  if (quote.snipeBlocked) return Response.json({ argus: true, blocked: true, reason: `opening surcharge active (${state.snipeBps}bps) — trading is blocked for the first seconds of the launch` });
  if (quote.exhaustsRange) return Response.json({ argus: true, blocked: true, reason: "trade too large for this pool's single-range liquidity — try a smaller size" });

  // quote.amountOut is the USDC the pool returns (after the hook's sell tax + pool
  // fee). totalMinOut protects the whole swap; our fee is a cut of the output that
  // TAKE_PORTION routes to the receiver, and the user's floor is the rest.
  const totalOutRaw = BigInt(Math.floor(quote.amountOut * 10 ** ARC_USDC_DECIMALS));
  const totalMinOut = (totalOutRaw * (10_000n - slip)) / 10_000n;
  if (totalMinOut <= 0n) return Response.json({ error: "min-out is zero" }, { status: 400 });

  const swap = buildArgusSwapTx({
    launch, side: "sell", amountInRaw: amountIn, amountOutMinimum: totalMinOut,
    fee: feeReceiver ? { receiver: feeReceiver, bps: feeBps } : undefined,
  });
  if (!swap) return Response.json({ error: "swap build failed" }, { status: 500 });

  const feeAmountUsdc = (totalOutRaw * BigInt(feeBps)) / 10_000n;
  const userMinOut = (totalMinOut * BigInt(10_000 - feeBps)) / 10_000n;
  const userAmountOut = (quote.amountOut * (10_000 - feeBps)) / 10_000;

  return Response.json({
    argus: true, blocked: false, side: "sell",
    tokenIn: tokenInfo,
    tokenOut: { address: ARC_USDC, symbol: "USDC", decimals: ARC_USDC_DECIMALS },
    fee: { receiver: feeReceiver, amountRaw: feeAmountUsdc.toString(), bps: feeBps },
    // The launch-token amount to approve + swap (unreduced — fee is on the output).
    swapAmountRaw: amountIn.toString(),
    to: swap.to, data: swap.data, value: swap.value.toString(), hook: launch.hook,
    amountOut: userAmountOut,
    amountOutMinimum: userMinOut.toString(),
    priceImpactBps: quote.priceImpactBps, totalCostBps: quote.totalCostBps,
  });
}
