/** Read-only liquidity snapshots for pools Kaleido's aggregator can route through. */

import { TOKENS } from "@/constants/registry";

const KYBER_POOLS = "https://earn-service.kyberswap.com/api/v1/explorer/pools";
const KYBER_ROUTES = "https://aggregator-api.kyberswap.com";
const GECKO_POOLS = "https://api.geckoterminal.com/api/v2/networks/arc/pools/multi";

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
  source: "kyberswap" | "kyberswap-routes";
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

type RouteLeg = {
  pool?: unknown;
  tokenIn?: unknown;
  tokenOut?: unknown;
  exchange?: unknown;
  poolExtra?: { fee?: unknown };
};

type GeckoPool = {
  id?: unknown;
  attributes?: {
    reserve_in_usd?: unknown;
    volume_usd?: { h24?: unknown };
    fee_percentage?: unknown;
  };
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
  if (chainId === 5042) return fetchArcRoutePools(fetchImpl);
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

/**
 * Arc's pool explorer contains every indexed pool, including markets Kaleido
 * never sends an order through. Build this list from live Kyber routes instead:
 * one representative USDC quote to each registered Arc asset, then enrich only
 * the pool IDs present in those executable routes with GeckoTerminal's public
 * TVL/volume figures. A pool therefore cannot appear merely because an indexer
 * found it; it must be part of a route our swap resolver can currently build.
 */
async function fetchArcRoutePools(fetchImpl: typeof fetch): Promise<ExternalPoolSnapshot | null> {
  const chainId = 5042;
  const tokens = TOKENS[chainId] ?? [];
  const usdc = tokens.find((token) => token.address.toLowerCase() === "0x3600000000000000000000000000000000000000");
  if (!usdc) return null;

  try {
    const routeResults = await Promise.all(tokens.filter((token) => token.address !== usdc.address).map(async (token) => {
      try {
        const query = new URLSearchParams({ tokenIn: usdc.address, tokenOut: token.address, amountIn: "1000000" });
        const response = await fetchImpl(`${KYBER_ROUTES}/arc/api/v1/routes?${query}`, {
          headers: { "x-client-id": process.env.KYBERSWAP_CLIENT_ID?.trim() || "kaleido" },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) return [];
        const body = (await response.json()) as { data?: { routeSummary?: { route?: RouteLeg[][] } } };
        return Array.isArray(body.data?.routeSummary?.route) ? body.data.routeSummary.route.flat() : [];
      } catch {
        return [];
      }
    }));

    const tokenByAddress = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));
    const routes = new Map<string, ExternalPool>();
    for (const leg of routeResults.flat()) {
      if (typeof leg.pool !== "string" || !/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(leg.pool)) continue;
      if (typeof leg.tokenIn !== "string" || typeof leg.tokenOut !== "string") continue;
      const tokenIn = tokenByAddress.get(leg.tokenIn.toLowerCase());
      const tokenOut = tokenByAddress.get(leg.tokenOut.toLowerCase());
      if (!tokenIn || !tokenOut) continue;
      const key = leg.pool.toLowerCase();
      if (routes.has(key)) continue;
      const rawFee = n(leg.poolExtra?.fee);
      routes.set(key, {
        address: leg.pool,
        chainId,
        exchange: typeof leg.exchange === "string" ? leg.exchange : "unknown",
        feeTier: rawFee === null ? null : rawFee / 10_000,
        tvlUsd: null,
        volume24hUsd: null,
        fees24hUsd: null,
        tokens: [
          { address: tokenIn.address, symbol: tokenIn.symbol },
          { address: tokenOut.address, symbol: tokenOut.symbol },
        ],
        tokenSymbols: [tokenIn.symbol, tokenOut.symbol],
      });
    }
    const pools = [...routes.values()];
    if (!pools.length) return null;

    const stats = new Map<string, GeckoPool>();
    for (let offset = 0; offset < pools.length; offset += 30) {
      const ids = pools.slice(offset, offset + 30).map((pool) => pool.address).join(",");
      const response = await fetchImpl(`${GECKO_POOLS}/${ids}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const body = (await response.json()) as { data?: GeckoPool[] };
      for (const row of Array.isArray(body.data) ? body.data : []) {
        if (typeof row.id !== "string") continue;
        const address = row.id.replace(/^arc_/i, "").toLowerCase();
        stats.set(address, row);
      }
    }

    for (const pool of pools) {
      const row = stats.get(pool.address.toLowerCase());
      pool.tvlUsd = n(row?.attributes?.reserve_in_usd);
      pool.volume24hUsd = n(row?.attributes?.volume_usd?.h24);
      const feePercent = n(row?.attributes?.fee_percentage);
      if (pool.feeTier === null && feePercent !== null) pool.feeTier = feePercent;
      pool.fees24hUsd = pool.volume24hUsd !== null && pool.feeTier !== null
        ? pool.volume24hUsd * pool.feeTier / 100
        : null;
    }
    pools.sort((a, b) => (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1));
    return {
      chainId,
      source: "kyberswap-routes",
      totalPools: pools.length,
      sampledPools: pools.length,
      pools,
      sampledTvlUsd: sum(pools.map((pool) => pool.tvlUsd)),
      sampledVolume24hUsd: sum(pools.map((pool) => pool.volume24hUsd)),
      sampledFees24hUsd: sum(pools.map((pool) => pool.fees24hUsd)),
      asOf: new Date().toISOString(),
      stale: false,
      partial: pools.some((pool) => pool.tvlUsd === null || pool.volume24hUsd === null),
    };
  } catch {
    return null;
  }
}


function sum(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

const cached = new Map<number, ExternalPoolSnapshot>();
const inflight = new Map<number, Promise<ExternalPoolSnapshot | null>>();

/** One bounded, shared refresh per minute. asOf is fetch time, not block time. */
export async function readExternalPools(chainId: number, fetchImpl?: typeof fetch): Promise<ExternalPoolSnapshot | null> {
  if (chainId !== 5042 && chainId !== 4663) return null;
  if (fetchImpl) return fetchExternalPools(chainId, fetchImpl);
  const previous = cached.get(chainId);
  if (previous && Date.now() - Date.parse(previous.asOf) < 60000) return previous;
  const pending = inflight.get(chainId);
  if (pending) return pending;
  const refresh = fetchExternalPools(chainId).then((data) => {
    if (data) { cached.set(chainId, data); return data; }
    const fallback = cached.get(chainId);
    return fallback ? { ...fallback, stale: true } : null;
  }).finally(() => { inflight.delete(chainId); });
  inflight.set(chainId, refresh);
  return refresh;
}
