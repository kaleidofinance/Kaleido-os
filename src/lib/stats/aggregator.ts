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
  /** Volume of fee-paying swaps only (migration 20260926000000). Absent before
   *  that migration, in which case fees fall back to total volume. */
  fee_volume_usd?: number | string | null;
}

/**
 * Stats from the view's row. Pure. Fees are charged on FEE-PAYING volume only —
 * a direct native-pool trade pays Kaleido no fee, so charging the configured
 * rate on all volume overstated revenue. Before the ledger migration the view
 * has no `fee_volume_usd` and every counted swap was fee-paying, so total
 * volume is the correct fallback.
 */
export function toAggregatorStats(
  data: AggregatorStatsRow,
  feeBps: number,
): Omit<AggregatorStats, "source" | "note"> {
  const volumeUsd = asNumber(data.volume_usd);
  const feeVolume =
    data.fee_volume_usd === undefined || data.fee_volume_usd === null
      ? volumeUsd
      : asNumber(data.fee_volume_usd);
  return {
    swapCount: asNumber(data.swap_count),
    volumeUsd,
    feesUsd: feeVolume * (feeBps / 10_000),
    lastOccurredAt: data.last_occurred_at,
  };
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

  /* Try the ledger-era columns first; before migration 20260926000000 the view
     has no fee_volume_usd, so fall back to the original four rather than going
     dark — deploy order cannot blank Total Volume. */
  const COLS = "swap_count, volume_usd, fees_usd, last_occurred_at";
  let res = await supabaseAdmin
    .from("aggregator_swap_stats")
    .select(`${COLS}, fee_volume_usd`)
    .maybeSingle<AggregatorStatsRow>();
  if (res.error)
    res = await supabaseAdmin
      .from("aggregator_swap_stats")
      .select(COLS)
      .maybeSingle<AggregatorStatsRow>();
  const { data, error } = res;

  if (error || !data) return null;

  /* The view keeps a 20 bps fallback for SQL consumers, but the API must honor
     the fee rate currently configured for this deployment. */
  return {
    ...toAggregatorStats(data, swapFeeBps()),
    source: "verified-kyberswap-ledger",
    note:
      "Cumulative swap volume on Arc from the swap_volume ledger — aggregator (KyberSwap) routes, Argus and direct native-pool trades, including swaps below the points floor. Fees are Kaleido fee revenue at the configured rate on fee-paying swaps only; external LP fees are excluded.",
  };
}
