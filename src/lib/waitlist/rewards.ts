import { supabaseAdmin } from "@/lib/supabase/serverClient";

const X_HOLD_MS = 5 * 60 * 60 * 1000;

export const WAITLIST_TASK_POINTS = {
  linked: 100,
  followed: 100,
  retweeted: 100,
  commented: 50,
  launch: 100,
  arcMainnet: 300,
  agent: 500,
  bridge: 500,
} as const;

/**
 * X tasks whose points are HELD out of Season 1 until real (API) verification.
 * They are attested, not verified, and an audit against the real X counts on
 * 2026-09-22 showed ~half of the retweet and comment claims were false (3,757
 * vs ~2,000 real retweets; 3,543 vs ~1,600 real comments). Follow is NOT held —
 * its claim count matched the real follower count — and `linked` is OAuth-
 * verified. A held task still shows as completed; its points just do not count
 * toward the Season-1 balance until they can be proven.
 */
export const HELD_TASKS: ReadonlySet<string> = new Set(["retweeted", "commented"]);

export interface WaitlistRewardRow {
  welcome_points: number | string | null;
  activated_at?: string | null;
  x_linked_at?: string | null;
  x_followed_at?: string | null;
  x_retweeted_at?: string | null;
  x_commented_at?: string | null;
  x_launch_at?: string | null;
  arc_mainnet_tx_at?: string | null;
  agent_tx_at?: string | null;
  bridge_tx_at?: string | null;
}

export interface WaitlistTaskReward {
  key: string;
  task: string;
  points: number;
  status: "pending" | "available" | "settled";
  availableAt: string | null;
  /** Completed but held out of the point totals until verified — see HELD_TASKS. */
  held: boolean;
}

export interface WaitlistRewardProjection {
  activated: boolean;
  settledWaitlistPoints: number;
  pendingPoints: number;
  availablePoints: number;
  referrals: number;
  referralPoints: number;
  welcomePoints: number;
  tasks: WaitlistTaskReward[];
}

function numberValue(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function heldTask(
  key: string,
  task: string,
  points: number,
  completedAt: string | null | undefined,
  now: number,
): WaitlistTaskReward {
  const held = HELD_TASKS.has(key);
  if (!completedAt) {
    return { key, task, points, status: "available", availableAt: null, held };
  }
  const availableAt = new Date(
    new Date(completedAt).getTime() + X_HOLD_MS,
  ).toISOString();
  return {
    key,
    task,
    points,
    status: now >= new Date(availableAt).getTime() ? "available" : "pending",
    availableAt,
    held,
  };
}

/** Pure task/points projection used by the server read path and tests. */
export function projectWaitlistRewards(
  row: WaitlistRewardRow,
  referrals: number,
  now = Date.now(),
): WaitlistRewardProjection {
  const welcomePoints = numberValue(row.welcome_points);
  const referralCount = Math.max(0, Math.floor(Number(referrals) || 0));
  const referralPoints = referralCount * 50;
  const tasks: WaitlistTaskReward[] = [
    heldTask("linked", "Link your X account", WAITLIST_TASK_POINTS.linked, row.x_linked_at, now),
    heldTask("followed", "Follow @kaleido_finance", WAITLIST_TASK_POINTS.followed, row.x_followed_at, now),
    heldTask("retweeted", "Repost the Mainnet Launch post", WAITLIST_TASK_POINTS.retweeted, row.x_retweeted_at, now),
    heldTask("commented", "Comment on the launch post", WAITLIST_TASK_POINTS.commented, row.x_commented_at, now),
    heldTask("launch", "Like and repost the Mainnet Launch post", WAITLIST_TASK_POINTS.launch, row.x_launch_at, now),
    {
      key: "arcMainnet",
      task: "First Arc mainnet transaction",
      points: WAITLIST_TASK_POINTS.arcMainnet,
      status: row.arc_mainnet_tx_at ? "settled" : "available",
      availableAt: null,
      held: false,
    },
    {
      key: "agent",
      task: "First Kaleido transaction",
      points: WAITLIST_TASK_POINTS.agent,
      status: row.agent_tx_at ? "settled" : "available",
      availableAt: null,
      held: false,
    },
    {
      key: "bridge",
      task: "Bridge assets in or out of Arc with Luca",
      points: WAITLIST_TASK_POINTS.bridge,
      status: row.bridge_tx_at ? "settled" : "available",
      availableAt: null,
      held: false,
    },
  ];

  const pendingPoints = tasks
    .filter((task) => task.status === "pending" && !task.held)
    .reduce((sum, task) => sum + task.points, 0);
  const availableTaskPoints = tasks
    .filter((task) => task.status === "available" && task.availableAt !== null && !task.held)
    .reduce((sum, task) => sum + task.points, 0);

  return {
    activated: Boolean(row.activated_at),
    settledWaitlistPoints: Boolean(row.activated_at)
      ? welcomePoints + referralPoints +
        tasks
          .filter((task) => (task.status === "settled" || task.status === "available") && !task.held)
          .reduce((sum, task) => sum + task.points, 0)
      : 0,
    // Pending means the five-hour hold only. Welcome/referral points and
    // completed holds are exposed separately as availablePoints.
    pendingPoints,
    availablePoints: Boolean(row.activated_at) ? availableTaskPoints : welcomePoints + referralPoints + availableTaskPoints,
    referrals: referralCount,
    referralPoints,
    welcomePoints,
    tasks,
  };
}

/**
 * Read the waitlist reward state for Luca without crediting or mutating it.
 * Verification and ledger writes remain owned by the existing waitlist routes.
 */
export async function readWaitlistRewardState(
  wallet: string,
): Promise<WaitlistRewardProjection | null> {
  if (!supabaseAdmin) return null;
  const [waitlist, leaderboard, ledger] = await Promise.all([
    supabaseAdmin
      .from("waitlist")
      .select(
        "welcome_points, activated_at, x_linked_at, x_followed_at, x_retweeted_at, x_commented_at, x_launch_at, arc_mainnet_tx_at, agent_tx_at, bridge_tx_at",
      )
      .eq("wallet", wallet)
      .maybeSingle<WaitlistRewardRow>(),
    supabaseAdmin
      .from("waitlist_leaderboard")
      .select("referrals")
      .eq("wallet", wallet)
      .maybeSingle<{ referrals: number | string | null }>(),
    supabaseAdmin
      .from("point_actions")
      .select("points")
      .eq("wallet", wallet)
      .eq("season", 1)
      .eq("source_slug", "waitlist"),
  ]);
  if (waitlist.error || !waitlist.data) return null;
  const projection = projectWaitlistRewards(
    waitlist.data,
    numberValue(leaderboard.data?.referrals),
  );
  if (ledger.error) return projection;

  const eligibleBeforeLedger =
    projection.welcomePoints +
    projection.referralPoints +
    projection.tasks
      .filter((task) => task.status !== "pending")
      .reduce((sum, task) => sum + task.points, 0);
  const credited = (ledger.data ?? []).reduce(
    (sum, row) => sum + numberValue((row as { points?: number | string | null }).points),
    0,
  );
  return {
    ...projection,
    availablePoints: projection.activated
      ? Math.max(0, eligibleBeforeLedger - credited)
      : eligibleBeforeLedger,
  };
}
