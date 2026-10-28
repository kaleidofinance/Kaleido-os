export const ANALYTICS_MAINNET_CHAIN_IDS = [5042, 4663, 56] as const;
export const EXTERNAL_MARKET_CHAIN_IDS = [4663, 56] as const;

export function analyticsChain(raw: string | null): number | undefined {
  if (!raw || raw === "all") return undefined;
  const id = Number(raw);
  if (!ANALYTICS_MAINNET_CHAIN_IDS.some((chainId) => chainId === id)) {
    throw new Error("Unsupported analytics network");
  }
  return id;
}
