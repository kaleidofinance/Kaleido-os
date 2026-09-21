import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { readAggregatorStats, type AggregatorStats } from "./aggregator";

/**
 * Platform-wide cumulative activity, summed across every Kaleido product for the
 * pool page's "Total volume" / "Total fees" strip.
 *
 * WHAT IS AND ISN'T COUNTED — being honest about the ledgers that exist:
 *
 *   - SWAPS (agent + manual UI): `aggregator_swap_stats`. On Arc every swap the
 *     app or Luca makes routes through the aggregator, which itself routes over
 *     native Kaleido pools AND external liquidity — so this one cumulative figure
 *     already IS "trades through the route and the native pools". Its fees are
 *     Kaleido's own fee revenue at the configured rate (external LP fees excluded
 *     on purpose — those are the LPs' money, not the protocol's).
 *   - BRIDGES: `cctp_transfers`. Every row is an on-chain-verified USDC burn
 *     (the record route checks the receipt before inserting), amount stored as
 *     the human USDC figure, so ~1:1 USD. This is the CCTP bridge volume.
 *
 *   NOT yet counted, and deliberately not faked: bridge volume that goes through
 *   the aggregator route (LI.FI) is not indexed anywhere, and per-bridge fees
 *   (CCTP fast fee / LI.FI integrator fee) are not stored — so bridge FEES are
 *   0 here until a ledger exists. When that ledger lands, add it to `readBridge`
 *   and to `feesUsd` below; nothing else changes.
 *
 * The two sources stay separate server-side (a 24h pool sample must never be
 * mistaken for all-time revenue), and this is the ONE place they are summed into
 * a headline total. `null` only when BOTH are unavailable — a partial (one
 * source mid-migration) still returns a real, if understated, total rather than
 * a blank tile.
 */

export interface BridgeStats {
  volumeUsd: number;
  count: number;
  source: "cctp-transfers";
}

export interface PlatformTotals {
  /** Swaps + bridges, of whichever sources answered. */
  volumeUsd: number;
  /** Swap fee revenue. Bridge fees are not indexed yet (see the file header). */
  feesUsd: number;
  breakdown: {
    swapVolumeUsd: number | null;
    swapFeesUsd: number | null;
    swapCount: number | null;
    bridgeVolumeUsd: number | null;
    bridgeCount: number | null;
  };
}

/** Sum the human USDC amounts of recorded bridge burns. Pure, so it is tested
 *  without a database; a non-numeric or non-positive amount contributes 0. */
export function sumBridgeVolume(
  rows: ReadonlyArray<{ amount?: string | null }>,
): number {
  let total = 0;
  for (const row of rows) {
    const n = Number(row?.amount ?? 0);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

/**
 * Cumulative CCTP bridge volume from the transfers ledger. Missing table (the
 * migration not applied yet) or no client reads as `null` — unavailable, not a
 * confident zero — exactly like readAggregatorStats.
 */
export async function readBridgeStats(): Promise<BridgeStats | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("cctp_transfers")
    .select("amount, status")
    .neq("status", "failed")
    .limit(50_000);
  if (error || !data) return null;
  return {
    volumeUsd: sumBridgeVolume(data as { amount?: string | null }[]),
    count: data.length,
    source: "cctp-transfers",
  };
}

export interface PlatformDeps {
  swaps: () => Promise<AggregatorStats | null>;
  bridge: () => Promise<BridgeStats | null>;
}

/** The aggregation, with its two readers injectable so the summing is tested
 *  without a database. */
export async function readPlatformTotals(
  deps: PlatformDeps = { swaps: readAggregatorStats, bridge: readBridgeStats },
): Promise<PlatformTotals | null> {
  const [swaps, bridge] = await Promise.all([deps.swaps(), deps.bridge()]);
  if (!swaps && !bridge) return null;

  const swapVolumeUsd = swaps?.volumeUsd ?? 0;
  const swapFeesUsd = swaps?.feesUsd ?? 0;
  const bridgeVolumeUsd = bridge?.volumeUsd ?? 0;

  return {
    volumeUsd: swapVolumeUsd + bridgeVolumeUsd,
    feesUsd: swapFeesUsd, // + bridge fees once a fee ledger exists
    breakdown: {
      swapVolumeUsd: swaps ? swaps.volumeUsd : null,
      swapFeesUsd: swaps ? swaps.feesUsd : null,
      swapCount: swaps ? swaps.swapCount : null,
      bridgeVolumeUsd: bridge ? bridge.volumeUsd : null,
      bridgeCount: bridge ? bridge.count : null,
    },
  };
}
