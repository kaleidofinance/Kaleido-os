import { ethers } from "ethers";
import { getKyberSwapExecution } from "@/lib/swap/kyberswap";
import { getFlyTradeExecution, hasFlyTrade } from "@/lib/swap/flytrade";
import { getLifiSwapExecution, hasLifiSwap } from "@/lib/swap/lifi";
import { getPeachTradeExecution } from "@/lib/peach/route";
import { ELYSIUM_CHAIN_ID, getElysiumTradeExecution } from "@/lib/elysium/route";
import { chainTokenByAddress } from "@/constants/tokens";
import type {
  SwapRouteRequest,
  AggregatorSwapRoute,
} from "@/lib/v2/intents/build";

/**
 * The aggregator-swap resolver: a pair in, a signable router call out.
 *
 * The same-chain sibling of lib/bridge/route.ts, and trusted the same way — the
 * `to`/`data` it returns are the origin of an `aggregatorSwap` Intent, come from
 * a vetted provider rather than the model, and target a router the auditor
 * whitelists. Isomorphic on purpose: serverPlanDeps and useLocalPlanner both
 * call it, so a swap planned in the chat and one planned on a page produce the
 * identical transaction. Provider credentials stay server-side through each
 * provider's API proxy.
 *
 * Used only where Kaleido runs no pools of its own — build.ts reaches it after
 * establishing there is no v3Router and no V3 venue. Every available external
 * provider is quoted concurrently and the highest executable amountOut wins.
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

  const request = {
    chainId: args.chainId,
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountUnits: units,
    address: args.userAddress,
    slippageBps: args.slippageBps,
  };
  const unknownArcAsset =
    args.chainId === 5042 &&
    (!chainTokenByAddress(args.chainId, args.tokenIn) ||
      !chainTokenByAddress(args.chainId, args.tokenOut));
  /* Peach is a launchpad route, not a general-purpose swap aggregator. Arc
     launch tokens are resolved exclusively through Peach, just as Argus
     launches have their own route. Never compare a launchpad quote against
     KyberSwap, Fly.trade, or LI.FI. */
  if (unknownArcAsset) {
    const peach = await getPeachTradeExecution(request);
    if (peach) {
      return {
        to: peach.to,
        data: peach.data,
        value: peach.value,
        spender: peach.spender,
        amountOut: peach.amountOut,
        venue: "peach",
      };
    }
  }
  const unknownElysiumAsset =
    args.chainId === ELYSIUM_CHAIN_ID &&
    (!chainTokenByAddress(args.chainId, args.tokenIn) ||
      !chainTokenByAddress(args.chainId, args.tokenOut));
  if (unknownElysiumAsset) {
    const elysium = await getElysiumTradeExecution(request);
    if (elysium) {
      return {
        to: elysium.to,
        data: elysium.data,
        value: elysium.value,
        spender: elysium.spender,
        amountOut: elysium.amountOut,
        venue: "elysium",
      };
    }
  }
  const [kyber, fly, lifi] = await Promise.all([
    getKyberSwapExecution(request),
    hasFlyTrade(args.chainId)
      ? getFlyTradeExecution(request)
      : Promise.resolve(null),
    hasLifiSwap(args.chainId)
      ? getLifiSwapExecution(request)
      : Promise.resolve(null),
  ]);
  const candidates = [
    { exec: kyber, venue: "kyberswap" },
    { exec: fly, venue: "fly" },
    { exec: lifi, venue: "lifi" },
  ].filter((c): c is { exec: NonNullable<typeof c.exec>; venue: string } =>
    Boolean(c.exec),
  );
  const best = candidates.sort((a, b) => {
    const aOut = BigInt(a.exec.amountOut);
    const bOut = BigInt(b.exec.amountOut);
    return aOut === bOut ? 0 : aOut > bOut ? -1 : 1;
  })[0];
  const exec = best?.exec;
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
    venue: best!.venue,
  };
}
