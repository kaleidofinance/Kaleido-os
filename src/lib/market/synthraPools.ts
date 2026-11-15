import type { ExternalPoolSnapshot } from "./externalPools";

const API = "https://ghost-trading-api.synthra.org";
const INTERNAL_POOL_CHAINS = new Set([4663, 5042, 99901]);
const CACHE_MS = 5 * 60 * 1000;

type SynthraPool = {
  address?: unknown;
  deployment?: unknown;
  fee?: unknown;
  token0?: { address?: unknown; symbol?: unknown };
  token1?: { address?: unknown; symbol?: unknown };
  tvlUsd?: unknown;
};

const cache = new Map<
  number,
  { expiresAt: number; value: ExternalPoolSnapshot | null }
>();

const address = (value: unknown) =>
  typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) ? value : null;

const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Read Synthra's indexed internal-pool universe. This is deliberately a
 * separate snapshot from the reviewed aggregator registry: it is metadata for
 * discovery, not proof that every row is a Kaleido-owned pool or an executable
 * route. Execution still requires a fresh best-execution quote and simulation.
 */
export async function readSynthraPools(
  chainId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalPoolSnapshot | null> {
  if (!INTERNAL_POOL_CHAINS.has(chainId)) return null;
  const previous = cache.get(chainId);
  if (previous && previous.expiresAt > Date.now()) return previous.value;
  const key = process.env.SYNTHRA_API_KEY ?? process.env.SYNTRA_API_KEY;
  if (!key) return null;
  try {
    const response = await fetchImpl(
      `${API}/v1/pools?chainId=${chainId}&includeOnchain=false&limit=500`,
      {
        headers: { "x-api-key": key },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      state?: unknown;
      pools?: unknown;
    };
    if (body.state !== "Success" || !Array.isArray(body.pools)) return null;
    const pools = body.pools.flatMap((raw): ExternalPoolSnapshot["pools"] => {
      const pool = raw as SynthraPool;
      const poolAddress = address(pool.address);
      const token0 = address(pool.token0?.address);
      const token1 = address(pool.token1?.address);
      const symbol0 =
        typeof pool.token0?.symbol === "string" ? pool.token0.symbol : "";
      const symbol1 =
        typeof pool.token1?.symbol === "string" ? pool.token1.symbol : "";
      const fee = numberOrNull(pool.fee);
      if (!poolAddress || !token0 || !token1 || !symbol0 || !symbol1) return [];
      return [
        {
          address: poolAddress,
          exchange: `synthra-${pool.deployment === "v3.1" ? "v3.1" : "v3"}`,
          feeTier: fee === null ? null : fee / 10_000,
          tvlUsd: numberOrNull(pool.tvlUsd),
          volume24hUsd: null,
          fees24hUsd: null,
          tokenSymbols: [symbol0, symbol1],
          tokens: [
            { address: token0, symbol: symbol0 },
            { address: token1, symbol: symbol1 },
          ],
          chainId,
          provider: "synthra",
          metricsSource: "Synthra indexed pool universe",
          metricsAsOf: new Date().toISOString(),
        },
      ];
    });
    const asOf = new Date().toISOString();
    const known = (values: Array<number | null>) => {
      const filtered = values.filter(
        (value): value is number => value !== null,
      );
      return filtered.length ? filtered.reduce((a, b) => a + b, 0) : null;
    };
    const value: ExternalPoolSnapshot = {
      chainId,
      source: "synthra",
      totalPools: pools.length,
      sampledPools: pools.length,
      pools,
      sampledTvlUsd: known(pools.map((pool) => pool.tvlUsd)),
      sampledVolume24hUsd: null,
      sampledFees24hUsd: null,
      asOf,
      stale: false,
      partial: true,
      refreshDueAt: new Date(Date.now() + CACHE_MS).toISOString(),
      refreshDue: false,
    };
    cache.set(chainId, { expiresAt: Date.now() + CACHE_MS, value });
    return value;
  } catch {
    cache.set(chainId, { expiresAt: Date.now() + 30_000, value: null });
    return null;
  }
}
