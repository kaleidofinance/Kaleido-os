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
 * Cumulative Kaleido swap volume (USD) for a wallet: the sum of `usd_value` over
 * its credited `swap` actions. Best-effort — a read error returns 0 so a DB
 * hiccup can never falsely inflate a wallet's tier. `wallet` must be lowercased
 * by the caller (as everywhere else in the waitlist path).
 */
export async function walletSwapVolumeUsd(
  admin: SupabaseClient,
  wallet: string,
): Promise<number> {
  const { data, error } = await admin
    .from("point_actions")
    .select("usd_value")
    .eq("wallet", wallet)
    .eq("source_slug", "swap")
    .eq("season", 1);
  if (error || !data) return 0;
  return data.reduce((sum, row) => sum + Number(row.usd_value ?? 0), 0);
}
