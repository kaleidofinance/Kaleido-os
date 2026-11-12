/** Read-only inventory of approved external pools. */

import {
  EXTERNAL_POOL_REGISTRY,
  EXTERNAL_POOL_REGISTRY_SCANNED_AT,
} from "./externalPoolRegistry";
import { EXTERNAL_POOL_SCAN_CHAIN_IDS } from "./externalPoolRefresh";

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
  provider?: "kyberswap" | "lifi" | "fly.trade";
  routeProbedAt?: string;
  metricsSource?: string;
  metricsAsOf?: string;
}

export interface ExternalPoolSnapshot {
  chainId: number;
  source: "registry";
  totalPools: number;
  sampledPools: number;
  pools: ExternalPool[];
  sampledTvlUsd: number | null;
  sampledVolume24hUsd: number | null;
  sampledFees24hUsd: number | null;
  /** The one-time approval scan, not a per-request provider refresh. */
  asOf: string;
  stale: boolean;
  partial: boolean;
  /** A checked-in snapshot is never silently refreshed during a user request. */
  refreshDueAt: string;
  refreshDue: boolean;
}

const SUPPORTED_EXTERNAL_CHAINS = new Set([5042, 4663, 56, 99901]);

const sum = (values: Array<number | null>): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
};

const snapshots = new Map<number, ExternalPoolSnapshot>();

export const EXTERNAL_POOL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function externalPoolRegistryStatus(now = Date.now()): {
  scannedAt: string;
  refreshDueAt: string;
  refreshDue: boolean;
  /** Mainnets eligible for the audited scan, including chains with no approved inventory yet. */
  scanChainIds: number[];
  /** Mainnets that currently have at least one approved registry entry. */
  inventoryChainIds: number[];
} {
  const scannedAtMs = Date.parse(EXTERNAL_POOL_REGISTRY_SCANNED_AT);
  const refreshDueAtMs = Number.isFinite(scannedAtMs)
    ? scannedAtMs + EXTERNAL_POOL_REFRESH_INTERVAL_MS
    : now;
  return {
    scannedAt: EXTERNAL_POOL_REGISTRY_SCANNED_AT,
    refreshDueAt: new Date(refreshDueAtMs).toISOString(),
    refreshDue: now >= refreshDueAtMs,
    scanChainIds: [...EXTERNAL_POOL_SCAN_CHAIN_IDS],
    inventoryChainIds: Array.from(
      new Set(EXTERNAL_POOL_REGISTRY.map((pool) => pool.chainId)),
    ),
  };
}

function snapshotFor(chainId: number): ExternalPoolSnapshot | null {
  if (!SUPPORTED_EXTERNAL_CHAINS.has(chainId)) return null;
  const pools = EXTERNAL_POOL_REGISTRY.filter(
    (pool) => pool.chainId === chainId,
  ).map((pool) => ({
    ...pool,
    provider: pool.provider ?? "kyberswap",
    routeProbedAt: pool.routeProbedAt ?? EXTERNAL_POOL_REGISTRY_SCANNED_AT,
    metricsSource:
      pool.metricsSource ?? "one-time reviewed pool metrics scan",
    metricsAsOf: pool.metricsAsOf ?? EXTERNAL_POOL_REGISTRY_SCANNED_AT,
    tokens: pool.tokens.map((token) => ({ ...token })),
    tokenSymbols: [...pool.tokenSymbols],
  }));
  if (!pools.length) return null;
  const registryStatus = externalPoolRegistryStatus();
  return {
    chainId,
    source: "registry",
    totalPools: pools.length,
    sampledPools: pools.length,
    pools,
    sampledTvlUsd: sum(pools.map((pool) => pool.tvlUsd)),
    sampledVolume24hUsd: sum(pools.map((pool) => pool.volume24hUsd)),
    sampledFees24hUsd: sum(pools.map((pool) => pool.fees24hUsd)),
    asOf: EXTERNAL_POOL_REGISTRY_SCANNED_AT,
    // Static inventory is intentional. Metrics are a dated snapshot and the
    // RH pool has no reserve from GeckoTerminal, so consumers can distinguish
    // it from a live, complete provider response.
    stale: true,
    partial: pools.some(
      (pool) => pool.tvlUsd === null || pool.volume24hUsd === null,
    ),
    refreshDueAt: registryStatus.refreshDueAt,
    refreshDue: registryStatus.refreshDue,
  };
}

/**
 * Return the checked-in approved inventory without contacting any provider.
 * The swap route still performs fresh executable quotes independently.
 */
export async function readExternalPools(
  chainId: number,
  _fetchImpl?: typeof fetch,
): Promise<ExternalPoolSnapshot | null> {
  const previous = snapshots.get(chainId);
  if (previous) return previous;
  const snapshot = snapshotFor(chainId);
  if (snapshot) snapshots.set(chainId, snapshot);
  return snapshot;
}

/** Accept HTTPS token art when a future registry refresh supplies it. */
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
