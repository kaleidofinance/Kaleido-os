import type { ITradingPair } from "@/constants/types/dex";

export type PoolQuestion = "count" | "list" | "liquidity" | "volume" | "volume24h" | "apr";

/** Only factual inventory/metric reads; advice and actions keep their own paths. */
export function poolQuestion(text: string): PoolQuestion | null {
  const q = text.toLowerCase().replace(/[?!.,]/g, "").trim();
  // Explicit chains, assets and periods need their own scoped reader. Never
  // silently answer a narrower request with the selected chain's whole book.
  if (/\b(on|base|ethereum|sepolia|abstract|bnb|polygon|testnet|across|yesterday|week|month|usdc|wusdc|eurc|argus|cirbtc)\b|0x[0-9a-f]/.test(q)) return null;
  if (/\bwhat (is|are) (a |an |the )?(liquidity |trading )?pools?\b/.test(q)) return null;
  if (/\b(swap|buy|sell|deposit|withdraw|add|remove|provide|create|invest|should|safe|risk|why|how do|how to)\b/.test(q)) return null;
  if (!/\bpools?\b|\btvl\b|\btotal liquidity\b/.test(q)) return null;
  if (/\b(highest|most|rank|compare|deepest|largest|total|volume|apr|tvl|liquidity)\b/.test(q)) {
    if (/\bapr\b/.test(q)) return "apr";
    if (/\bvolume\b/.test(q)) return /\b(24h|24 hours|daily|today)\b/.test(q) ? "volume24h" : "volume";
    if (/\btvl\b|\bliquidity\b|\bdeepest\b|\blargest\b/.test(q)) return "liquidity";
    // A comparison without a named metric needs clarification/cloud reasoning.
    return null;
  }
  if (/\bhow many\b|\bnumber of\b|\bpool count\b/.test(q)) return "count";
  if (/^(?:please )?(?:list|show|which|what)\b/.test(q) && /\bpools?\b/.test(q)) return "list";
  return null;
}

export function personalPortfolioQuestion(text: string): boolean {
  if (/0x[0-9a-f]+|\b(on|in|across|swap|buy|sell|deposit|withdraw|should|why|how to)\b/i.test(text)) return false;
  return /^(?:please )?(?:show|list|what|how much|do i have)\b/i.test(text.trim()) &&
    /\b(my|i|wallet)\b/i.test(text) &&
    /\b(balances?|holdings?|positions?|portfolio|net worth)\b/i.test(text);
}

const measured = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const money = (value: number) => value.toLocaleString("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
});

export function poolSnapshotAnswer(
  kind: PoolQuestion,
  payload: unknown,
  scope: { chainId: number; chainName: string },
): string {
  const unavailable = `I couldn't read the pool snapshot on ${scope.chainName} right now. Try again shortly.`;
  if (!payload || typeof payload !== "object") return unavailable;
  const data = payload as { pools?: unknown; error?: unknown; stale?: boolean };
  if (data.error || !Array.isArray(data.pools)) return unavailable;
  const pools = data.pools.filter((p): p is ITradingPair =>
    p && typeof p === "object" && p.chainId === scope.chainId &&
    typeof p.token0?.symbol === "string" && typeof p.token1?.symbol === "string");
  const suffix = data.stale ? " This is a cached snapshot and may be out of date." : " These are current snapshot values and can change.";
  if (!pools.length) return `No pools were returned in the latest snapshot on ${scope.chainName}; this does not confirm there are none on-chain.`;
  if (kind === "count") return `The latest snapshot contains ${pools.length} Kaleido pools on ${scope.chainName}.${suffix}`;
  if (kind === "list") return `Kaleido pools on ${scope.chainName}:\n\n` + pools.slice(0, 20).map(p =>
    `- ${p.token0.symbol} / ${p.token1.symbol}${measured(p.feeBps) ? ` · ${p.feeBps / 100}% fee` : ""}`
  ).join("\n") + (pools.length > 20 ? `\n\nShowing 20 of ${pools.length}.` : "") + suffix;
  const field = kind === "volume" ? "volumeTotal" : kind === "volume24h" ? "volume24h" : kind === "apr" ? "apr" : "liquidity";
  const known = pools.filter(p => measured(p[field])).sort((a, b) => b[field]! - a[field]!);
  if (!known.length) return `The ${kind === "volume" ? "all-time volume" : kind} figures are unavailable for the ${pools.length} pools in the ${scope.chainName} snapshot.`;
  const label = kind === "volume" ? "all-time volume" : kind === "volume24h" ? "estimated 24-hour volume (extrapolated from sampled blocks)" : kind === "apr" ? "annualized fee APR" : "liquidity (TVL)";
  const total = kind === "apr" ? "" : `Measured ${label}: ${money(known.reduce((sum, p) => sum + p[field]!, 0))}. `;
  const partial = known.length < pools.length ? ` Figures are missing for ${pools.length - known.length} pools; the total/ranking covers measured pools only.` : "";
  return `${scope.chainName} — ${total}Pools ranked by ${label}:\n\n` + known.slice(0, 10).map(p =>
    `- ${p.token0.symbol} / ${p.token1.symbol}${measured(p.feeBps) ? ` (${p.feeBps / 100}% fee)` : ""}: ${kind === "apr" ? `${p[field]!.toFixed(2)}%` : money(p[field]!)}`
  ).join("\n") + partial + (kind === "apr" ? " APR is annualized from sampled fees, not a guaranteed return." : "") + suffix;
}
