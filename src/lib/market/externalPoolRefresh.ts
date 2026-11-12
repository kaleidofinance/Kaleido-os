import type { ExternalPoolRegistryEntry } from "./externalPoolRegistry";

export type ExternalPoolProvider = "kyberswap" | "lifi" | "fly.trade";

export interface RoutePoolObservation {
  provider: ExternalPoolProvider;
  chainId: number;
  pool: string;
  exchange: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  observedAt: string;
  blockNumber: number | null;
}

export interface PoolMetricsObservation {
  tvlUsd: number | null;
  volume24hUsd: number | null;
  fees24hUsd: number | null;
  asOf: string;
  source: string;
}

export interface RefreshCandidate {
  route: RoutePoolObservation;
  metrics: PoolMetricsObservation;
  tokens: Array<{ address: string; symbol: string }>;
  feeTier?: number | null;
}

export interface RefreshDecision {
  approved: boolean;
  reasons: string[];
  entry?: ExternalPoolRegistryEntry;
}

export const EXTERNAL_POOL_SCAN_CHAIN_IDS = [5042, 4663, 56, 99901] as const;
export const DEFAULT_EXTERNAL_POOL_TVL_FLOOR_USD = 10_000;

const ADDRESS_RE = /^0x[0-9a-f]{40}$/i;
const BYTES32_RE = /^0x[0-9a-f]{64}$/i;

function isPoolAddress(value: string): boolean {
  return ADDRESS_RE.test(value) || BYTES32_RE.test(value);
}

function isPositiveIntegerString(value: string): boolean {
  return /^\d+$/.test(value) && value !== "0";
}

/**
 * Pull the leaf liquidity legs from Kyber's nested route response.
 *
 * Kyber can return a meta-pool wrapper whose `extra._ce.ces` contains the
 * actual DEX leg. The wrapper is not a pool we should display, so this helper
 * walks to the deepest legs and deduplicates them by pool address.
 */
export function extractKyberRoutePools(
  payload: unknown,
  input: {
    chainId: number;
    tokenSymbols: Record<string, string>;
    observedAt?: string;
    provider?: ExternalPoolProvider;
  },
): RoutePoolObservation[] {
  const summary =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data?: { routeSummary?: unknown } }).data?.routeSummary
      : undefined;
  if (!summary || typeof summary !== "object") return [];
  const routeSummary = summary as {
    route?: unknown;
    timestamp?: unknown;
  };
  const observedAt =
    input.observedAt ??
    (typeof routeSummary.timestamp === "number"
      ? new Date(routeSummary.timestamp * 1000).toISOString()
      : new Date().toISOString());
  const seen = new Set<string>();
  const output: RoutePoolObservation[] = [];

  const visit = (leg: unknown): void => {
    if (!leg || typeof leg !== "object") return;
    const value = leg as {
      pool?: unknown;
      exchange?: unknown;
      tokenIn?: unknown;
      tokenOut?: unknown;
      swapAmount?: unknown;
      amountOut?: unknown;
      poolExtra?: { blockNumber?: unknown };
      extra?: { _ce?: { ces?: unknown } };
    };
    const children = value.extra?._ce?.ces;
    if (Array.isArray(children) && children.length > 0) {
      children.forEach(visit);
      return;
    }
    if (
      typeof value.pool !== "string" ||
      typeof value.exchange !== "string" ||
      typeof value.tokenIn !== "string" ||
      typeof value.tokenOut !== "string" ||
      typeof value.swapAmount !== "string" ||
      typeof value.amountOut !== "string" ||
      !isPoolAddress(value.pool) ||
      !isPositiveIntegerString(value.swapAmount) ||
      !isPositiveIntegerString(value.amountOut)
    )
      return;
    const key = `${input.chainId}:${value.pool.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    output.push({
      provider: input.provider ?? "kyberswap",
      chainId: input.chainId,
      pool: value.pool,
      exchange: value.exchange,
      tokenIn: value.tokenIn,
      tokenOut: value.tokenOut,
      amountIn: value.swapAmount,
      amountOut: value.amountOut,
      observedAt,
      blockNumber:
        typeof value.poolExtra?.blockNumber === "number"
          ? value.poolExtra.blockNumber
          : null,
    });
  };

  const route = routeSummary.route;
  if (Array.isArray(route)) route.flat(Infinity).forEach(visit);
  return output;
}

/**
 * Decide whether a provider observation is safe enough for the checked-in
 * research registry. A route hit alone never passes this gate.
 */
export function evaluateExternalPoolCandidate(
  candidate: RefreshCandidate,
  options: { minTvlUsd?: number; isKnownToken?: (address: string) => boolean } = {},
): RefreshDecision {
  const reasons: string[] = [];
  const minTvlUsd = options.minTvlUsd ?? DEFAULT_EXTERNAL_POOL_TVL_FLOOR_USD;
  const route = candidate.route;
  const metrics = candidate.metrics;

  if (!(EXTERNAL_POOL_SCAN_CHAIN_IDS as readonly number[]).includes(route.chainId)) {
    reasons.push("chain is not an approved mainnet scan target");
  }
  if (!isPoolAddress(route.pool)) reasons.push("pool identifier is invalid");
  if (!isPositiveIntegerString(route.amountIn) || !isPositiveIntegerString(route.amountOut)) {
    reasons.push("route probe did not return a positive amount");
  }
  if (candidate.tokens.length !== 2) reasons.push("pool must have exactly two tokens");
  if (
    candidate.tokens.some(
      (token) =>
        !isPoolAddress(token.address) ||
        !token.symbol.trim() ||
        token.symbol.trim().toUpperCase() === "UNKNOWN",
    )
  ) {
    reasons.push("token identity is incomplete");
  }
  if (options.isKnownToken && candidate.tokens.some((token) => !options.isKnownToken?.(token.address))) {
    reasons.push("one or more token addresses are not in the chain registry");
  }
  if (metrics.tvlUsd === null || !Number.isFinite(metrics.tvlUsd)) {
    reasons.push("TVL is unknown");
  } else if (metrics.tvlUsd < minTvlUsd) {
    reasons.push(`TVL is below the $${minTvlUsd.toLocaleString()} approval floor`);
  }
  if (!metrics.asOf || Number.isNaN(Date.parse(metrics.asOf))) {
    reasons.push("pool metrics timestamp is invalid");
  }

  if (reasons.length > 0) return { approved: false, reasons };

  const entry: ExternalPoolRegistryEntry = {
    address: route.pool,
    chainId: route.chainId,
    exchange: route.exchange,
    feeTier: candidate.feeTier ?? null,
    tvlUsd: metrics.tvlUsd,
    volume24hUsd: metrics.volume24hUsd,
    fees24hUsd: metrics.fees24hUsd,
    tokens: candidate.tokens.map((token) => ({ ...token })),
    tokenSymbols: candidate.tokens.map((token) => token.symbol),
    provider: route.provider,
    routeProbedAt: route.observedAt,
    metricsSource: metrics.source,
    metricsAsOf: metrics.asOf,
  };
  return { approved: true, reasons: [], entry };
}
