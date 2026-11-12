import {
  evaluateExternalPoolCandidate,
  type PoolMetricsObservation,
  type RefreshDecision,
  type RoutePoolObservation,
} from "./externalPoolRefresh";
import { readExternalPoolMetrics } from "./externalPoolMetrics";
import { scanKyberPools, type ExternalPoolScanPair } from "./externalPoolScanner";

export interface ExternalPoolRefreshReport {
  generatedAt: string;
  provider: "kyberswap";
  routeObservations: number;
  approved: RefreshDecision[];
  rejected: Array<{ route: RoutePoolObservation; reasons: string[] }>;
  failures: Array<{ chainId: number; tokenIn: string; tokenOut: string; reason: string }>;
  warnings: string[];
}

export async function buildExternalPoolRefreshReport(
  pairs: readonly ExternalPoolScanPair[],
  options: {
    fetchImpl?: typeof fetch;
    clientId?: string;
    readMetrics?: (
      chainId: number,
      poolAddress: string,
      fetchImpl?: typeof fetch,
    ) => Promise<ReturnType<typeof readExternalPoolMetrics>>;
    isKnownToken?: (chainId: number, address: string) => boolean;
  } = {},
): Promise<ExternalPoolRefreshReport> {
  const routeScan = await scanKyberPools(pairs, options);
  const readMetrics = options.readMetrics ?? readExternalPoolMetrics;
  const approved: RefreshDecision[] = [];
  const rejected: ExternalPoolRefreshReport["rejected"] = [];
  let unavailableElysiumMetrics = false;
  const warnings = routeScan.failures.length
    ? ["One or more provider route probes failed; the report is partial."]
    : [];

  for (const route of routeScan.observations) {
    const metricsResult = await readMetrics(route.chainId, route.pool, options.fetchImpl);
    if (!metricsResult.metrics) {
      if (route.chainId === 99901) unavailableElysiumMetrics = true;
      rejected.push({
        route,
        reasons: [metricsResult.reason ?? "pool metrics unavailable"],
      });
      continue;
    }
    const metric: PoolMetricsObservation = {
      tvlUsd: metricsResult.metrics.tvlUsd,
      volume24hUsd: metricsResult.metrics.volume24hUsd,
      fees24hUsd: metricsResult.metrics.fees24hUsd,
      asOf: metricsResult.metrics.asOf,
      source: metricsResult.metrics.source,
    };
    const pair = pairs.find(
      (item) =>
        item.chainId === route.chainId &&
        [item.tokenIn, item.tokenOut].some(
          (address) => address.toLowerCase() === route.tokenIn.toLowerCase(),
        ) &&
        [item.tokenIn, item.tokenOut].some(
          (address) => address.toLowerCase() === route.tokenOut.toLowerCase(),
        ),
    );
    const tokens = pair
      ? [
          { address: route.tokenIn, symbol: pair.tokenSymbols[route.tokenIn.toLowerCase()] ?? "UNKNOWN" },
          { address: route.tokenOut, symbol: pair.tokenSymbols[route.tokenOut.toLowerCase()] ?? "UNKNOWN" },
        ]
      : [];
    const decision = evaluateExternalPoolCandidate(
      { route, metrics: metric, tokens },
      { isKnownToken: (address) => options.isKnownToken?.(route.chainId, address) ?? true },
    );
    if (decision.approved) approved.push(decision);
    else rejected.push({ route, reasons: decision.reasons });
  }

  if (unavailableElysiumMetrics) {
    warnings.push(
      "One or more Elysium pools had no dated metrics response; those pools cannot be approved automatically.",
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    provider: "kyberswap",
    routeObservations: routeScan.observations.length,
    approved,
    rejected,
    failures: routeScan.failures,
    warnings,
  };
}
