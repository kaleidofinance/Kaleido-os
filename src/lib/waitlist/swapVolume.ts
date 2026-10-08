import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Waitlist "swap volume on Kaleido" milestone tasks.
 *
 * A wallet's cumulative Kaleido swap volume is the sum of the USD size of every
 * swap the `points-swap` cron has credited it — i.e. `point_actions` rows with
 * `source_slug = 'swap'`, whose `usd_value` IS the dollar size of the trade (see
 * api/cron/points-swap). So the milestone is fully on-chain-derived and
 * verifiable; there is nothing to self-attest and no separate column to store.
 *
 * Tiers are milestones on the SAME volume, and pay the HIGHEST reached tier only
 * (product decision 2026-09-23): $100 of volume pays 1,000 — not 500+700+1,000.
 * `swapVolumePoints` returns that single highest-tier value; the lower tiers a
 * wallet has also crossed are shown in the UI as "Included", so the points shown
 * always sum to what is credited.
 *
 * Because the points are folded into the waitlist `eligible` total in standing()
 * and topped up forward-only by reconcileWaitlistPoints, a wallet that trades up
 * to a higher tier after activating is still credited the extra on its next read
 * — no migration and no per-tier timestamp needed.
 */
export type SwapVolumeTier = {
  /** Stable key the API/UI use to identify the tier. */
  key: "vol10" | "vol50" | "vol100" | "vol300";
  /** Minimum cumulative USD swap volume to complete the tier. */
  threshold: number;
  /** kPoint awarded when this is the highest tier reached (the TOTAL). */
  points: number;
  /**
   * A tier that pays ON TOP of a lower one instead of replacing it. Its total is
   * still `points` (highest-tier-only is unchanged), but the UI shows it as
   * `+(points − that tier's points)` and keeps the lower tier showing its own
   * points rather than "included" — so what is shown still sums to what is
   * credited. $300 (added 2026-09-29, product decision): 2,000 total, shown as
   * "+1,000" on top of the $100 tier's 1,000.
   */
  addsTo?: SwapVolumeTier["key"];
};

/** Ascending by threshold. Keep sorted — `swapVolumePoints` relies on it. */
export const SWAP_VOLUME_TIERS: readonly SwapVolumeTier[] = [
  { key: "vol10", threshold: 10, points: 500 },
  { key: "vol50", threshold: 50, points: 700 },
  { key: "vol100", threshold: 100, points: 1000 },
  { key: "vol300", threshold: 300, points: 2000, addsTo: "vol100" },
] as const;

/**
 * The kPoint a wallet earns for its swap volume: the HIGHEST tier whose
 * threshold it has met, or 0 if it has not met the smallest. Highest-tier-only,
 * so the tiers never stack.
 */
export function swapVolumePoints(volumeUsd: number): number {
  let points = 0;
  for (const tier of SWAP_VOLUME_TIERS) {
    if (volumeUsd >= tier.threshold) points = tier.points;
  }
  return points;
}

/** The highest tier a wallet has reached, or null if none. */
export function highestSwapTier(volumeUsd: number): SwapVolumeTier | null {
  let reached: SwapVolumeTier | null = null;
  for (const tier of SWAP_VOLUME_TIERS) {
    if (volumeUsd >= tier.threshold) reached = tier;
  }
  return reached;
}

export type SwapVolumeTierState = SwapVolumeTier & {
  /** The wallet has met this tier's threshold. */
  done: boolean;
  /** Points to SHOW for this tier: the increment for an `addsTo` tier, else `points`. */
  displayPoints: number;
  /**
   * A higher tier is also met, so this tier's points are already covered by the
   * highest tier and do NOT add to the balance (highest-tier-only payout).
   */
  superseded: boolean;
};

export type SwapVolumeStanding = {
  /** Cumulative Kaleido swap volume in USD. */
  volumeUsd: number;
  /** Per-tier state for the UI. */
  tiers: SwapVolumeTierState[];
  /** The kPoint actually credited (highest reached tier, or 0). */
  points: number;
};

/** Build the per-tier UI state + credited points from a volume figure. */
export function swapVolumeStanding(volumeUsd: number): SwapVolumeStanding {
  const top = highestSwapTier(volumeUsd);
  const byKey = new Map(SWAP_VOLUME_TIERS.map((t) => [t.key, t]));
  const tiers: SwapVolumeTierState[] = SWAP_VOLUME_TIERS.map((tier) => {
    const done = volumeUsd >= tier.threshold;
    const base = tier.addsTo ? byKey.get(tier.addsTo) : undefined;
    return {
      ...tier,
      done,
      displayPoints: base ? tier.points - base.points : tier.points,
      // Completed, but a strictly higher tier is also completed → its points are
      // rolled into that higher tier (we pay the highest only) — UNLESS the top
      // tier adds on top of this one, in which case this one still shows its own
      // points and the top shows only the increment.
      superseded:
        done &&
        top !== null &&
        tier.threshold < top.threshold &&
        top.addsTo !== tier.key,
    };
  });
  return { volumeUsd, tiers, points: swapVolumePoints(volumeUsd) };
}

/**
 * What the volume task counts, for one wallet, in USD:
 *
 *   swaps       every swap in the volume ledger (`swap_volume`): Luca and the
 *               Swap page alike, including trades under $10 and back-and-forth
 *               trades that the points scanner nets out. Points are a separate
 *               rule; volume is what the wallet actually traded.
 *   collateral  collateral the wallet has deposited right now, at its current
 *               value (`point_snapshots`, source `collateral_idle`, latest row
 *               per chain). Withdrawing it removes it from the total again.
 *
 * Both are read on every call, so the forward-only top-up in reconciliation
 * picks up new volume without any stored column.
 */
export async function walletTaskVolumeUsd(
  admin: SupabaseClient,
  wallet: string,
): Promise<number> {
  const { data, error } = await admin
    .from("wallet_task_volume")
    .select("swaps_usd, collateral_usd")
    .eq("wallet", wallet)
    .maybeSingle();
  // A read error counts as zero, so a DB hiccup can never inflate a tier.
  if (error || !data) return 0;
  return taskVolumeTotal(data.swaps_usd, data.collateral_usd);
}

/** Pure: the task volume from its two parts. Both are USD; non-numbers count 0. */
export function taskVolumeTotal(swapsUsd: unknown, collateralUsd: unknown): number {
  const a = Number(swapsUsd ?? 0);
  const b = Number(collateralUsd ?? 0);
  return (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
}

/** Pure: the wallet's current collateral from its snapshot rows — the newest row
 *  per chain, summed. Rows may arrive in any order. */
export function latestCollateralUsd(
  rows: readonly { chain_id: number; usd_value: unknown; taken_at: string }[],
): number {
  const newest = new Map<number, { usd: number; at: number }>();
  for (const r of rows) {
    const at = Date.parse(r.taken_at);
    if (!Number.isFinite(at)) continue;
    const prev = newest.get(r.chain_id);
    if (!prev || at > prev.at) newest.set(r.chain_id, { usd: Number(r.usd_value ?? 0), at });
  }
  let total = 0;
  for (const v of newest.values()) total += Number.isFinite(v.usd) ? v.usd : 0;
  return total;
}

/** Pure: sum of `usd_value` over ledger rows. */
export function sumUsd(rows: readonly { usd_value?: unknown }[]): number {
  return rows.reduce((sum, r) => sum + Number(r.usd_value ?? 0), 0);
}
