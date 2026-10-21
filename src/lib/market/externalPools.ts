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
  tokens: Array<{ address: string; symbol: string }>;
  chainId: number;
}

export interface ExternalPoolSnapshot {
  chainId: number;
  source: "kyberswap";
  totalPools: number;
  sampledPools: number;
  pools: ExternalPool[];
  sampledTvlUsd: number | null;
  sampledVolume24hUsd: number | null;
  sampledFees24hUsd: number | null;
  asOf: string;
  stale: boolean;
  partial: boolean;
}

type RawPool = {
  address?: unknown;
  exchange?: unknown;
  feeTier?: unknown;
  tvl?: unknown;
  volume1d?: unknown;
  earnFee?: unknown;
  chain?: { id?: unknown };
  tokens?: Array<{ address?: unknown; symbol?: unknown }>;
};

const n = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const x = Number(value);
  return Number.isFinite(x) && x >= 0 ? x : null;
};

/** Top external pools only: the upstream endpoint returns a ranked sample, not an index. */
async function fetchExternalPools(
  chainId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalPoolSnapshot | null> {
  if (chainId !== 4663) return null;
  try {
    const res = await fetchImpl(`${KYBER_POOLS}?chainIds=${chainId}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      code?: number;
      data?: { pools?: RawPool[]; pagination?: { totalItems?: unknown } };
    };
    if (body.code !== 0 || !Array.isArray(body.data?.pools)) return null;
    const seen = new Set<string>();
    const pools = body.data.pools.flatMap((row) => {
      if (!row || typeof row.address !== "string" || !/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(row.address) || Number(row.chain?.id) !== chainId || !Array.isArray(row.tokens)) return [];
      const tokens = row.tokens.flatMap((t) => t && typeof t.address === "string" && /^0x[0-9a-f]{40}$/i.test(t.address) && typeof t.symbol === "string" ? [{ address: t.address, symbol: t.symbol }] : []);
      if (tokens.length !== 2) return [];
      const key = `${row.exchange}:${row.address.toLowerCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        address: row.address,
        chainId, tokens,
        exchange: typeof row.exchange === "string" ? row.exchange : "unknown",
        feeTier: n(row.feeTier),
        tvlUsd: n(row.tvl),
        volume24hUsd: n(row.volume1d),
        fees24hUsd: n(row.earnFee),
        tokenSymbols: tokens.map((t) => t.symbol),
      }];
    });
    return {
      chainId,
      source: "kyberswap",
      totalPools: n(body.data.pagination?.totalItems) ?? pools.length,
      sampledPools: pools.length,
      pools,
      sampledTvlUsd: sum(pools.map((p) => p.tvlUsd)),
      sampledVolume24hUsd: sum(pools.map((p) => p.volume24hUsd)),
      sampledFees24hUsd: sum(pools.map((p) => p.fees24hUsd)),
      asOf: new Date().toISOString(),
      stale: false,
      partial: pools.length < (n(body.data.pagination?.totalItems) ?? pools.length) || pools.some((p) => p.tvlUsd === null || p.volume24hUsd === null || p.fees24hUsd === null),
    };
  } catch {
    return null;
  }
}


function sum(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

let cached: ExternalPoolSnapshot | null = null;
let inflight: Promise<ExternalPoolSnapshot | null> | null = null;

/** One bounded, shared refresh per minute. asOf is fetch time, not block time. */
export async function readExternalPools(chainId: number, fetchImpl?: typeof fetch): Promise<ExternalPoolSnapshot | null> {
  if (chainId !== 4663) return null;
  if (fetchImpl) return fetchExternalPools(chainId, fetchImpl);
  if (cached && Date.now() - Date.parse(cached.asOf) < 60000) return cached;
  if (!inflight) inflight = fetchExternalPools(chainId).then((data) => {
    if (data) { cached = data; return data; }
    return cached ? { ...cached, stale: true } : null;
  }).finally(() => { inflight = null; });
  return inflight;
}
