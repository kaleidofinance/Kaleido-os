/**
 * The chain a plan must be signed on, when its own intents name one: a bridge's
 * source, an aggregator swap / CCTP mint's chain, a send "on Base". Null for an
 * ordinary plan, which is signed on the connected chain.
 *
 * One derivation for the two places that need it — the audit (agent page) and
 * the sign flow's chain pin (PlanReview) — so they can never disagree about
 * which chain a plan is for.
 */
import type { Intent } from "@/lib/v2/intents";

export function planChainOf(intents: readonly Intent[]): number | null {
  for (const it of intents) {
    if (it.kind === "bridge") return it.fromChainId;
    if (it.kind === "aggregatorSwap" || it.kind === "cctpReceive")
      return it.chainId;
    if (it.kind === "transfer" && it.chainId != null) return it.chainId;
  }
  return null;
}
