export const ANALYTICS_MAINNET_CHAIN_IDS = [5042, 4663, 56] as const;
// External liquidity is available for every supported mainnet. Arc is sourced
// from executable KyberSwap routes (rather than the explorer index), while
// Robinhood and BSC use their indexed pool feeds.
export const EXTERNAL_MARKET_CHAIN_IDS = [5042, 4663, 56] as const;

export function analyticsChain(raw: string | null): number | undefined {
  if (!raw || raw === "all") return undefined;
  const id = Number(raw);
  if (!ANALYTICS_MAINNET_CHAIN_IDS.some((chainId) => chainId === id)) {
    throw new Error("Unsupported analytics network");
  }
  return id;
}
