import { transactionTaskPointsFor, type TransactionTaskTimestamps } from "./transactionTasks";
import { swapVolumePoints } from "./swapVolume";

/**
 * A wallet's task points — the ONE calculation behind every place that states
 * them: the /rewards card (api/waitlist GET), the activation credit
 * (api/waitlist/activate) and the background sync that keeps the Season 1
 * ledger level with the card (sync.ts).
 *
 * Why it lives here: each of those used to carry its own copy of the per-task
 * table and its own sum, and they drifted — the card showed one number while the
 * leaderboard showed another, because the ledger was only topped up when that
 * wallet happened to open the Rewards page. One pure function means the card
 * and the ledger can only differ by the sync interval, never by definition.
 */

/** Points per referred friend who joined and linked X. */
export const PER_REFERRAL = 50;

/** Per-task kPoint: comment is 50, the rest 100. `bitget` is retired but kept
 *  so wallets that completed it keep what they earned. */
export const X_TASK_POINTS = {
  linked: 100,
  followed: 100,
  retweeted: 100,
  commented: 50,
  launch: 100,
  bitget: 100,
} as const;

export type XTaskPointKey = keyof typeof X_TASK_POINTS;

/** The waitlist column recording when each X task was done. */
export const X_TASK_COLUMNS: Record<XTaskPointKey, string> = {
  linked: "x_linked_at",
  followed: "x_followed_at",
  retweeted: "x_retweeted_at",
  commented: "x_commented_at",
  launch: "x_launch_at",
  bitget: "x_bitget_at",
};

/** X-task kPoint is held this long before it counts — the tasks are attested,
 *  not API-verified, so the hold is a nudge to actually do them. */
export const X_HOLD_MS = 5 * 60 * 60 * 1000;

/** The waitlist row fields the task total reads. Extra keys are ignored. */
export type TaskRow = TransactionTaskTimestamps & {
  welcome_points?: number | string | null;
} & Partial<Record<string, unknown>>;

/** X-task points that have cleared their hold at `now`. */
export function countedXPoints(row: TaskRow, now: number): number {
  let sum = 0;
  for (const [key, col] of Object.entries(X_TASK_COLUMNS) as [XTaskPointKey, string][]) {
    const at = row[col];
    if (typeof at !== "string" || !at) continue;
    if (now >= new Date(at).getTime() + X_HOLD_MS) sum += X_TASK_POINTS[key];
  }
  return sum;
}

/**
 * The task total a wallet has earned: welcome + referrals + X tasks past their
 * hold + transaction tasks + the highest swap-volume tier reached. Pure.
 */
export function eligibleTaskPoints(args: {
  row: TaskRow;
  referrals: number;
  swapVolumeUsd: number;
  now: number;
}): number {
  const { row, referrals, swapVolumeUsd, now } = args;
  return (
    Number(row.welcome_points ?? 0) +
    PER_REFERRAL * Math.max(0, referrals) +
    countedXPoints(row, now) +
    transactionTaskPointsFor(row) +
    swapVolumePoints(swapVolumeUsd)
  );
}

/**
 * The Season 1 top-up a wallet is owed, or 0. Pure.
 *
 * Forward-only: the ledger is append-only and a credit already made is never
 * clawed back, so a total that shrank (a retired or capped task) owes nothing.
 * A wallet that never activated and was never credited owes nothing either —
 * its points stay pending until activation writes the first credit.
 */
export function topUpOwed(args: {
  eligible: number;
  credited: number;
  activated: boolean;
}): number {
  const { eligible, credited, activated } = args;
  if (!activated && credited <= 0) return 0;
  const delta = eligible - credited;
  return delta > 0 ? delta : 0;
}

/** The ledger row for a top-up. The tx_hash is stable per (wallet, eligible
 *  total), so the `unique (chain_id, tx_hash)` constraint makes two runs that
 *  race on the same top-up write it once. */
export function topUpRow(wallet: string, eligible: number, delta: number, at: string) {
  return {
    wallet,
    source_slug: "waitlist",
    season: 1,
    tx_hash: `waitlist:reconcile:${wallet}:${eligible}`,
    chain_id: 5042,
    usd_value: 0,
    multiplier_applied: 1.0,
    points: delta,
    is_agent_initiated: false,
    occurred_at: at,
  };
}
