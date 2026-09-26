import { supabaseAdmin } from "@/lib/supabase/serverClient";

/**
 * Swap VOLUME, recorded independently of points.
 *
 * Every figure called "volume" used to be derived from credited `point_actions`
 * rows, and a swap under the Season-1 `min_usd` ($10) earns 0 points and writes
 * no row — so sub-$10 swaps were missing from Total Volume. The indexer now
 * records every swap it can value here FIRST, then asks the points engine
 * whether to credit it. See migration 20260926000000_swap_volume_ledger.
 */
export type SwapVenue = "aggregator" | "argus" | "native-pool" | "other";

export interface SwapVolumeRecord {
  chainId: number;
  txHash: string;
  wallet: string;
  usdValue: number;
  venue: SwapVenue;
  /** Paid Kaleido's fee to SWAP_FEE_RECEIVER — fees are charged on these only. */
  feePaid: boolean;
  occurredAt: string;
}

/**
 * Record one swap in the volume ledger. True on success, false when the ledger
 * could not be written (no client, missing migration, a DB error).
 *
 * FAIL-OPEN, like the cursor: a ledger miss must never stop points from being
 * credited — the caller counts it and moves on, and a later backfill re-records
 * it (the write is idempotent on chain + tx, and on a repeat only refreshes the
 * venue/fee flags, never the recorded dollar value).
 */
export async function recordSwapVolume(r: SwapVolumeRecord): Promise<boolean> {
  if (!supabaseAdmin) return false;
  if (!(r.usdValue >= 0) || !Number.isFinite(r.usdValue)) return false;
  try {
    const { error } = await supabaseAdmin.rpc("record_swap_volume", {
      p_chain_id: r.chainId,
      p_tx_hash: r.txHash,
      p_wallet: r.wallet,
      p_usd_value: r.usdValue,
      p_venue: r.venue,
      p_fee_paid: r.feePaid,
      p_occurred_at: r.occurredAt,
    });
    return !error;
  } catch {
    return false;
  }
}
