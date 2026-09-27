import { supabaseAdmin } from "@/lib/supabase/serverClient";
import type { SwapLeg } from "@/lib/points/netFlow";

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
  /** What the wallet gave up / received, as netFlow asset keys. Omitted when the
   *  swap could not be classified — the row is still recorded, just not netted. */
  assetIn?: string;
  assetOut?: string;
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
  const base = {
    p_chain_id: r.chainId,
    p_tx_hash: r.txHash,
    p_wallet: r.wallet,
    p_usd_value: r.usdValue,
    p_venue: r.venue,
    p_fee_paid: r.feePaid,
    p_occurred_at: r.occurredAt,
  };
  const withAssets =
    r.assetIn && r.assetOut
      ? { ...base, p_asset_in: r.assetIn, p_asset_out: r.assetOut }
      : null;
  try {
    if (withAssets) {
      const { error } = await supabaseAdmin.rpc("record_swap_volume", withAssets);
      if (!error) return true;
      /* A database that predates migration 20260927000000 has no 9-argument
         writer, so the call above fails. Record the volume without the assets
         rather than lose the row: this swap then just is not netted, and code
         shipped before the migration costs nothing. */
    }
    const { error } = await supabaseAdmin.rpc("record_swap_volume", base);
    return !error;
  } catch {
    return false;
  }
}

/**
 * The wallet's earlier classified swaps on the same UTC day, oldest first — the
 * `prior` that netFlow.netCreditableUsd nets the current swap against.
 *
 * Reads the ledger, which the indexer writes before each points decision, so
 * swaps from earlier runs are all here. The current swap is excluded by hash.
 * Rows without assets (recorded before netting existed, or unclassifiable) are
 * skipped, which is what makes the rule forward-only.
 *
 * Null when the ledger cannot be read. The caller then credits the swap on its
 * full size, as before this rule — a read failure must not zero anyone's points.
 */
export async function priorLegsToday(args: {
  chainId: number;
  wallet: string;
  occurredAt: string;
  excludeTxHash: string;
}): Promise<SwapLeg[] | null> {
  if (!supabaseAdmin) return null;
  const at = new Date(args.occurredAt);
  if (Number.isNaN(at.getTime())) return null;
  const dayStart = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  ).toISOString();
  try {
    const { data, error } = await supabaseAdmin
      .from("swap_volume")
      .select("tx_hash, usd_value, asset_in, asset_out, occurred_at")
      .eq("chain_id", args.chainId)
      .eq("wallet", args.wallet.toLowerCase())
      .gte("occurred_at", dayStart)
      .lte("occurred_at", args.occurredAt)
      .not("asset_in", "is", null)
      .not("asset_out", "is", null)
      .order("occurred_at", { ascending: true })
      .order("recorded_at", { ascending: true });
    if (error || !data) return null;
    const exclude = args.excludeTxHash.toLowerCase();
    return data
      .filter((r) => String(r.tx_hash).toLowerCase() !== exclude)
      .map((r) => ({
        assetIn: String(r.asset_in),
        assetOut: String(r.asset_out),
        usd: Number(r.usd_value),
      }));
  } catch {
    return null;
  }
}
