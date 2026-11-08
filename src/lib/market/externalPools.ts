/** Read-only liquidity snapshots for pools Kaleido's aggregator can route through. */

import { TOKENS } from "@/constants/registry";

const KYBER_ROUTES = "https://aggregator-api.kyberswap.com";
const GECKO_NETWORKS = "https://api.geckoterminal.com/api/v2/networks";

// These symbols select identities from our own chain/address registry only.
// Upstream token symbols never grant admission. Launches and stock tokens are
// deliberately outside this conservative general-liquidity discovery set.
const CORE_ASSETS: Record<number, readonly string[]> = {
  5042: ["USDC", "WUSDC", "EURC", "cirBTC", "WETH"],
  4663: ["USDC", "USDT", "USDG", "WETH"],
  56: ["USDC", "USDT", "USD1", "FDUSD", "WBNB", "BTCB"],
};

export interface ExternalPool {
  address: string;
  exchange: string;
  feeTier: number | null;
  tvlUsd: number | null;
  volume24hUsd: number | null;
  fees24hUsd: number | null;
  tokenSymbols: string[];
  tokens: Array<{ address: string; symbol: string; logoURI?: string }>;
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

// Upstream logos belong to the token address in this chain-scoped response.
// Accept HTTPS images only; missing or malformed metadata keeps the placeholder.
export function tokenLogoUri(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

const n = (value: unknown): number | null => {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    typeof value === "boolean"
  )
    return null;
  const x = Number(value);
  return Number.isFinite(x) && x >= 0 ? x : null;
};

/**
 * Use the same route-based discovery on all supported mainnets. Only core
 * registry assets may appear in any hop; quotes must return positive output
 * and pools must have measured liquidity. This is discovery eligibility, not
 * a contract audit or an execution guarantee for an arbitrary trade size.
 */
async function fetchRoutePools(
  chainId: number,
  fetchImpl: typeof fetch,
): Promise<ExternalPoolSnapshot | null> {
  const network = { 56: "bsc", 5042: "arc", 4663: "robinhood" }[chainId];
  if (!network) return null;
  const tokens = (TOKENS[chainId] ?? []).filter((token) =>
    CORE_ASSETS[chainId]?.includes(token.symbol),
  );
  const usdc = tokens.find(
    (token) => token.symbol === (chainId === 4663 ? "USDG" : "USDC"),
  );
  if (!usdc) return null;

  try {
    const routeResults = await Promise.all(
      tokens
        .filter((token) => token.address !== usdc.address)
        .map(async (token) => {
          try {
            const query = new URLSearchParams({
              tokenIn: usdc.address,
              tokenOut: token.address,
              amountIn: (10n ** BigInt(usdc.decimals)).toString(),
            });
            const response = await fetchImpl(
              `${KYBER_ROUTES}/${network}/api/v1/routes?${query}`,
              {
                headers: {
                  "x-client-id":
                    process.env.KYBERSWAP_CLIENT_ID?.trim() || "kaleido",
                },
                cache: "no-store",
                signal: AbortSignal.timeout(8000),
              },
            );
            if (!response.ok) return [];
            const body = (await response.json()) as {
              code?: number;
              data?: {
                routeSummary?: {
                  amountOut?: string;
                  amountInUsd?: unknown;
                  amountOutUsd?: unknown;
                  route?: RouteLeg[][];
                };
              };
            };
            const summary = body.data?.routeSummary;
            if (
              (body.code !== undefined && body.code !== 0) ||
              !summary ||
              typeof summary.amountOut !== "string" ||
              !/^\d+$/.test(summary.amountOut) ||
              BigInt(summary.amountOut) <= 0n ||
              !Array.isArray(summary.route)
            )
              return [];
            // The probe spends one unit of a USD stable asset. Reject absent
            // pricing, a depegged base, and a fill whose USD values differ by
            // more than 5% in either direction (including suspicious overquotes).
            const inputUsd = n(summary.amountInUsd);
            const outputUsd = n(summary.amountOutUsd);
            if (
              inputUsd === null ||
              outputUsd === null ||
              Math.abs(inputUsd - 1) > 0.05 ||
              Math.abs(outputUsd / inputUsd - 1) > 0.05
            )
              return [];
            const legs = summary.route.flat();
            // Reject the entire route if any hop leaves the core asset set.
            const allowed = new Set(
              tokens.map((item) => item.address.toLowerCase()),
            );
            return legs.every(
              (leg) =>
                typeof leg.tokenIn === "string" &&
                allowed.has(leg.tokenIn.toLowerCase()) &&
                typeof leg.tokenOut === "string" &&
                allowed.has(leg.tokenOut.toLowerCase()),
            )
              ? legs
              : [];
          } catch {
            return [];
          }
        }),
    );

    const tokenByAddress = new Map(
      tokens.map((token) => [token.address.toLowerCase(), token]),
    );
    const routes = new Map<string, ExternalPool>();
    for (const leg of routeResults.flat()) {
      if (
        typeof leg.pool !== "string" ||
        !/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(leg.pool)
      )
        continue;
      if (typeof leg.tokenIn !== "string" || typeof leg.tokenOut !== "string")
        continue;
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
    let pools = [...routes.values()];
    if (!pools.length) return null;

    const stats = new Map<string, GeckoPool>();
    for (let offset = 0; offset < pools.length; offset += 30) {
      const ids = pools
        .slice(offset, offset + 30)
        .map((pool) => pool.address)
        .join(",");
      const response = await fetchImpl(
        `${GECKO_NETWORKS}/${network}/pools/multi/${ids}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!response.ok) continue;
      const body = (await response.json()) as { data?: GeckoPool[] };
      for (const row of Array.isArray(body.data) ? body.data : []) {
        if (typeof row.id !== "string") continue;
        if (!row.id.toLowerCase().startsWith(`${network}_`)) continue;
        const address = row.id.slice(network.length + 1).toLowerCase();
        stats.set(address, row);
      }
    }

    for (const pool of pools) {
      const row = stats.get(pool.address.toLowerCase());
      pool.tvlUsd = n(row?.attributes?.reserve_in_usd);
      pool.volume24hUsd = n(row?.attributes?.volume_usd?.h24);
      const feePercent = n(row?.attributes?.fee_percentage);
      if (pool.feeTier === null && feePercent !== null)
        pool.feeTier = feePercent;
      pool.fees24hUsd =
        pool.volume24hUsd !== null && pool.feeTier !== null
          ? (pool.volume24hUsd * pool.feeTier) / 100
          : null;
    }
    // No unmeasured or empty pools in the discovery list.
    pools = pools.filter((pool) => pool.tvlUsd !== null && pool.tvlUsd > 0);
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
      partial: pools.some(
        (pool) => pool.tvlUsd === null || pool.volume24hUsd === null,
      ),
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
export async function readExternalPools(
  chainId: number,
  fetchImpl?: typeof fetch,
): Promise<ExternalPoolSnapshot | null> {
  if (chainId !== 5042 && chainId !== 4663 && chainId !== 56) return null;
  if (fetchImpl) return fetchRoutePools(chainId, fetchImpl);
  const previous = cached.get(chainId);
  if (previous && Date.now() - Date.parse(previous.asOf) < 60000)
    return previous;
  const pending = inflight.get(chainId);
  if (pending) return pending;
  const refresh = fetchRoutePools(chainId, fetchImpl ?? fetch)
    .then((data) => {
      if (data) {
        cached.set(chainId, data);
        return data;
      }
      // Route eligibility must be current; don't advertise stale routes on failure.
      cached.delete(chainId);
      return null;
    })
    .finally(() => {
      inflight.delete(chainId);
    });
  inflight.set(chainId, refresh);
  return refresh;
}
