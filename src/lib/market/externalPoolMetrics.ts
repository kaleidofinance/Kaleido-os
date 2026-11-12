export interface ExternalPoolMetrics {
  tvlUsd: number | null;
  volume24hUsd: number | null;
  fees24hUsd: number | null;
  asOf: string;
  source: string;
}

export interface ExternalPoolMetricsResult {
  status: "ok" | "unavailable";
  metrics: ExternalPoolMetrics | null;
  reason?: string;
}

/** GeckoTerminal slugs are explicit; an unknown chain fails closed. */
export const GECKO_NETWORK_SLUGS: Record<number, string> = {
  5042: "arc",
  4663: "robinhood-chain",
  56: "bsc",
  99901: "elysium",
};

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function retryAfterMs(response: Response, fallbackMs: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 5_000);
  }
  return fallbackMs;
}

async function wait(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch dated pool metrics for the review job. GeckoTerminal exposes Elysium
 * under the `elysium` network slug, so Elysium route observations are valued by
 * the same dated reserve/volume/fee source as the other supported mainnets.
 * Route output is never treated as TVL.
 */
export async function readExternalPoolMetrics(
  chainId: number,
  poolAddress: string,
  fetchImpl: typeof fetch = fetch,
  options: { retryDelayMs?: number; maxRetries?: number } = {},
): Promise<ExternalPoolMetricsResult> {
  const slug = GECKO_NETWORK_SLUGS[chainId];
  if (!slug) {
    return {
      status: "unavailable",
      metrics: null,
      reason: `No authoritative pool-metrics source is configured for chain ${chainId}.`,
    };
  }
  try {
    const maxRetries = options.maxRetries ?? 2;
    const retryDelayMs = options.retryDelayMs ?? 250;
    let response: Response | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      response = await fetchImpl(
        `https://api.geckoterminal.com/api/v2/networks/${slug}/pools/${poolAddress}`,
        { headers: { accept: "application/json" }, cache: "no-store" },
      );
      if (response.status !== 429 || attempt === maxRetries) break;
      await wait(retryAfterMs(response, retryDelayMs * 2 ** attempt));
    }
    if (!response) {
      return { status: "unavailable", metrics: null, reason: "Pool metrics provider returned no response." };
    }
    if (!response.ok) {
      return {
        status: "unavailable",
        metrics: null,
        reason: `Pool metrics provider returned HTTP ${response.status}.`,
      };
    }
    const json = (await response.json()) as {
      data?: {
        attributes?: {
          reserve_in_usd?: unknown;
          volume_usd?: { h24?: unknown };
          fee_usd_24h?: unknown;
          updated_at?: unknown;
        };
      };
    };
    const attributes = json.data?.attributes;
    if (!attributes) {
      return {
        status: "unavailable",
        metrics: null,
        reason: "Pool metrics provider returned no attributes.",
      };
    }
    const asOf =
      typeof attributes.updated_at === "string" &&
      !Number.isNaN(Date.parse(attributes.updated_at))
        ? attributes.updated_at
        : new Date().toISOString();
    return {
      status: "ok",
      metrics: {
        tvlUsd: numberOrNull(attributes.reserve_in_usd),
        volume24hUsd: numberOrNull(attributes.volume_usd?.h24),
        fees24hUsd: numberOrNull(attributes.fee_usd_24h),
        asOf,
        source: "GeckoTerminal",
      },
    };
  } catch (error) {
    return {
      status: "unavailable",
      metrics: null,
      reason: `Pool metrics provider failed: ${(error as Error).message}`,
    };
  }
}
