/** Read-only external liquidity snapshot for chains where Kaleido has no seeded pools. */

const KYBER_POOLS = "https://earn-service.kyberswap.com/api/v1/explorer/pools";

export interface ExternalPool {
  address: string;
  exchange: string;
  feeTier: number | null;
  tvlUsd: number | null;
  volume24hUsd: number | null;
  fees24hUsd: number | null;
  tokenSymbols: string[];
}

export interface ExternalPoolSnapshot {
  chainId: number;
  source: "kyberswap";
  totalPools: number;
  sampledPools: number;
  pools: ExternalPool[];
  sampledTvlUsd: number;
  sampledVolume24hUsd: number;
  sampledFees24hUsd: number;
  asOf: string;
}

type RawPool = {
  address?: unknown;
  exchange?: unknown;
  feeTier?: unknown;
  tvl?: unknown;
  volume1d?: unknown;
  earnFee?: unknown;
  tokens?: Array<{ symbol?: unknown }>;
};

const n = (value: unknown): number | null => {
  const x = Number(value);
  return Number.isFinite(x) && x >= 0 ? x : null;
};

/** Top external pools only: the upstream endpoint returns a ranked sample, not an index. */
export async function readExternalPools(
  chainId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalPoolSnapshot | null> {
  if (chainId !== 4663) return null;
  try {
    const res = await fetchImpl(`${KYBER_POOLS}?chainIds=${chainId}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      code?: number;
      data?: { pools?: RawPool[]; pagination?: { totalItems?: unknown } };
    };
    if (body.code !== 0 || !body.data?.pools) return null;
    const pools = body.data.pools.flatMap((row) => {
      if (typeof row.address !== "string") return [];
      return [{
        address: row.address,
        exchange: typeof row.exchange === "string" ? row.exchange : "unknown",
        feeTier: n(row.feeTier),
        tvlUsd: n(row.tvl),
        volume24hUsd: n(row.volume1d),
        fees24hUsd: n(row.earnFee),
        tokenSymbols: (row.tokens ?? []).flatMap((t) =>
          typeof t.symbol === "string" ? [t.symbol] : [],
        ),
      }];
    });
    return {
      chainId,
      source: "kyberswap",
      totalPools: n(body.data.pagination?.totalItems) ?? pools.length,
      sampledPools: pools.length,
      pools,
      sampledTvlUsd: pools.reduce((sum, p) => sum + (p.tvlUsd ?? 0), 0),
      sampledVolume24hUsd: pools.reduce((sum, p) => sum + (p.volume24hUsd ?? 0), 0),
      sampledFees24hUsd: pools.reduce((sum, p) => sum + (p.fees24hUsd ?? 0), 0),
      asOf: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
