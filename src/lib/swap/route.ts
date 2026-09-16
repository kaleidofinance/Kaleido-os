import { ethers } from "ethers";
import { getKyberSwapExecution } from "@/lib/swap/kyberswap";
import type {
  SwapRouteRequest,
  AggregatorSwapRoute,
} from "@/lib/v2/intents/build";

/**
 * The aggregator-swap resolver: a pair in, a signable router call out.
 *
 * The same-chain sibling of lib/bridge/route.ts, and trusted the same way — the
 * `to`/`data` it returns are the origin of an `aggregatorSwap` Intent, come from
 * KyberSwap rather than the model, and target a router the auditor whitelists
 * (isKnownSwapRouter). Isomorphic on purpose: serverPlanDeps and useLocalPlanner
 * both call it, so a swap planned in the chat and one planned on a page produce
 * the identical transaction, and getKyberSwapExecution keeps the fee/key
 * server-side either way (browser via /api/swap/quote).
 *
 * Used only where Kaleido runs no pools of its own — build.ts reaches it after
 * establishing there is no v3Router and no V3 venue but `hasKyberSwap(chainId)`.
 */
export async function resolveSwapRoute(
  args: SwapRouteRequest & { chainId: number; userAddress: string },
): Promise<AggregatorSwapRoute | { error: string }> {
  if (!ethers.isAddress(args.userAddress))
    return { error: "Connect a wallet to resolve a swap route." };

  let units: string;
  try {
    units = ethers.parseUnits(args.amount, args.decimalsIn).toString();
  } catch {
    return { error: `${args.amount} isn't a valid amount.` };
  }
  if (BigInt(units) <= 0n)
    return { error: `A swap needs a positive amount, not ${args.amount}.` };

  const exec = await getKyberSwapExecution({
    chainId: args.chainId,
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountUnits: units,
    address: args.userAddress,
    slippageBps: args.slippageBps,
  });
  if (!exec)
    return {
      error:
        "No swap route for that pair right now. The pools that fill it may be too thin, or the aggregator has no route.",
    };

  return {
    to: exec.to,
    data: exec.data,
    value: exec.value,
    spender: exec.spender,
    amountOut: exec.amountOut,
    venue: "kyberswap",
  };
}
