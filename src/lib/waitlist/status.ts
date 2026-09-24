import type { SwapVolumeStanding } from "./swapVolume";

/**
 * The single source of truth for the `/api/waitlist` response shape and the two
 * task surfaces that render it (the `/waitlist` page and the `/leaderboard`
 * RewardsPanel).
 *
 * WHY THIS EXISTS: those two surfaces each kept their own copy of this shape and
 * drifted. When `arcMainnet` was retired from `transactionTasks`, the route and
 * the /waitlist page were updated but the RewardsPanel copy still typed (and
 * rendered) `transactionTasks.arcMainnet.done` — reading `.done` off `undefined`
 * crashed the whole leaderboard for every connected wallet. With one shared type
 * imported by the route AND both pages, that mismatch is a tsc error at build:
 * a reader can't touch a key that isn't here, and the route can't return a shape
 * that isn't this. Adding or removing a task is now exactly one edit, here.
 */

/** X (Twitter) task keys. `bitget` is a retired task kept in the payload for an
 *  older deployed client; the current UIs don't render it. */
export type XTaskKey =
  | "linked"
  | "followed"
  | "retweeted"
  | "commented"
  | "launch"
  | "bitget";

/** On-chain transaction task keys. `arcMainnet` was retired 2026-09-23 (farmable);
 *  do NOT re-add a key here without adding it to the route's response too. */
export type TxTaskKey = "agent" | "bridge";

export interface XTaskState {
  done: boolean;
  counted: boolean;
  countsAt: string | null;
  /** The self-attested task has closed at its claim cap (see xCap.ts). */
  closed?: boolean;
}

export interface WaitlistStatus {
  wallet: string;
  refCode: string;
  referrals: number;
  rank: number | null;
  points: number;
  heldPoints: number;
  welcomePoints: number;
  referralPoints: number;
  xHandle: string | null;
  xTasks: Record<XTaskKey, XTaskState>;
  swapVolume: SwapVolumeStanding;
  activated: boolean;
  transactionTasks: Record<TxTaskKey, { done: boolean }>;
}
