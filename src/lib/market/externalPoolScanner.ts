import { extractKyberRoutePools, type RoutePoolObservation } from "./externalPoolRefresh";

export interface ExternalPoolScanPair {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  tokenSymbols: Record<string, string>;
  amountIn: string;
}

export interface ExternalPoolScanResult {
  observations: RoutePoolObservation[];
  failures: Array<{ chainId: number; tokenIn: string; tokenOut: string; reason: string }>;
}

const KYBER_SLUGS: Record<number, string> = {
  5042: "arc",
  4663: "robinhood",
  56: "bsc",
  99901: "elysium",
};

function isPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value) && value !== "0";
}

/** Scan executable Kyber routes without approving or persisting any pool. */
export async function scanKyberPools(
  pairs: readonly ExternalPoolScanPair[],
  options: { fetchImpl?: typeof fetch; clientId?: string } = {},
): Promise<ExternalPoolScanResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const observations: RoutePoolObservation[] = [];
  const failures: ExternalPoolScanResult["failures"] = [];
  const seen = new Set<string>();

  for (const pair of pairs) {
    const slug = KYBER_SLUGS[pair.chainId];
    if (!slug || !isPositiveInteger(pair.amountIn)) {
      failures.push({
        chainId: pair.chainId,
        tokenIn: pair.tokenIn,
        tokenOut: pair.tokenOut,
        reason: !slug ? "Kyber chain is not configured" : "scan amount must be positive integer",
      });
      continue;
    }
    try {
      const query = new URLSearchParams({
        tokenIn: pair.tokenIn,
        tokenOut: pair.tokenOut,
        amountIn: pair.amountIn,
      });
      const response = await fetchImpl(
        `https://aggregator-api.kyberswap.com/${slug}/api/v1/routes?${query}`,
        {
          headers: {
            accept: "application/json",
            ...(options.clientId ? { "x-client-id": options.clientId } : {}),
          },
          cache: "no-store",
        },
      );
      if (!response.ok) {
        failures.push({
          chainId: pair.chainId,
          tokenIn: pair.tokenIn,
          tokenOut: pair.tokenOut,
          reason: `Kyber returned HTTP ${response.status}`,
        });
        continue;
      }
      const found = extractKyberRoutePools(await response.json(), {
        chainId: pair.chainId,
        tokenSymbols: pair.tokenSymbols,
      });
      if (!found.length) {
        failures.push({
          chainId: pair.chainId,
          tokenIn: pair.tokenIn,
          tokenOut: pair.tokenOut,
          reason: "Kyber returned no underlying pool leg",
        });
        continue;
      }
      for (const observation of found) {
        const key = `${observation.chainId}:${observation.pool.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          observations.push(observation);
        }
      }
    } catch (error) {
      failures.push({
        chainId: pair.chainId,
        tokenIn: pair.tokenIn,
        tokenOut: pair.tokenOut,
        reason: `Kyber request failed: ${(error as Error).message}`,
      });
    }
  }
  return { observations, failures };
}
