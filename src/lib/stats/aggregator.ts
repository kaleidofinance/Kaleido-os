import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { swapFeeBps } from "@/lib/swap/kyberswapServer";

export interface AggregatorStats {
  swapCount: number;
  volumeUsd: number;
  feesUsd: number;
  lastOccurredAt: string | null;
  source: "verified-kyberswap-ledger";
  note: string;
}

interface AggregatorStatsRow {
  swap_count: number | string | null;
  volume_usd: number | string | null;
  fees_usd: number | string | null;
  last_occurred_at: string | null;
}

const asNumber = (value: number | string | null): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Read cumulative Kyber-routed swap metrics from the server-only ledger.
 *
 * A missing Supabase view is reported as unavailable rather than returning a
 * confident zero. This matters during a migration rollout: zero is a valid
 * launch total, while an unavailable source is not.
 */
export async function readAggregatorStats(): Promise<AggregatorStats | null> {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from("aggregator_swap_stats")
    .select("swap_count, volume_usd, fees_usd, last_occurred_at")
    .maybeSingle<AggregatorStatsRow>();

  if (error || !data) return null;

  const volumeUsd = asNumber(data.volume_usd);
  /* The view keeps a 20 bps fallback for SQL consumers, but the API must honor
     the fee rate currently configured for this deployment. */
  const feesUsd = volumeUsd * (swapFeeBps() / 10_000);

  return {
    swapCount: asNumber(data.swap_count),
    volumeUsd,
    feesUsd,
    lastOccurredAt: data.last_occurred_at,
    source: "verified-kyberswap-ledger",
    note:
      "Cumulative verified swap volume on Arc — aggregator (KyberSwap) routes and direct native-pool trades. Fees are Kaleido fee revenue at the configured rate; external LP fees are excluded.",
  };
}
