import { supabaseAdmin } from "@/lib/supabase/serverClient";

/**
 * Per-task claim cap for the self-attested X tasks.
 *
 * We cannot API-verify the comment task without a paid X plan, and an audit on
 * 2026-09-22 showed ~half of the self-attested claims were false. Rather than
 * hold the points (which penalises the honest majority), we cap how many wallets
 * can EVER claim it: once `X_TASK_CAP` wallets have completed the task it
 * auto-closes, so an unverifiable task cannot be farmed without bound.
 *
 * Only `commented` is capped. `linked` (real OAuth) and `followed` (its claim
 * count matched the real follower count) are trustworthy. The two repost tasks —
 * `retweeted` ("Repost the launch post") and `launch` ("Like & repost the
 * Mainnet Launch post") — are the active mainnet-launch push and must stay open
 * to new claimants (product decision 2026-09-23), so they are NOT capped either.
 *
 * The cap is forward-only: wallets that already completed the task keep their
 * points — the lock only blocks NEW claims.
 */
export const X_TASK_CAP = 1000;

/**
 * The capped tasks, keyed by the `xTasks` key the waitlist API returns, mapped
 * to the `waitlist` timestamp column that records a completion.
 */
export const CAPPED_X_TASKS = {
  commented: "x_commented_at",
} as const;

export type CappedTaskKey = keyof typeof CAPPED_X_TASKS;

const CAPPED_COLUMNS: ReadonlySet<string> = new Set(Object.values(CAPPED_X_TASKS));

/** Whether a `waitlist` timestamp column belongs to a capped task. */
export const isCappedColumn = (col: string): boolean => CAPPED_COLUMNS.has(col);

const ALL_OPEN: Record<CappedTaskKey, boolean> = {
  commented: false,
};

// A task closes once and stays closed (new claims are rejected, so its count
// only ever grows), so the closed set is safe to cache. This keeps the read
// path (standing()) from running a count query on every page view.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; val: Record<CappedTaskKey, boolean> } | null = null;

/**
 * Which capped tasks are currently closed (>= X_TASK_CAP completions). Cached
 * for CACHE_TTL_MS. Best-effort: a failed count leaves the task OPEN rather than
 * falsely locking it. Used by the read path to grey out closed tasks; the write
 * path (api/waitlist/x) counts live so enforcement is never stale.
 */
export async function getClosedXTasks(): Promise<Record<CappedTaskKey, boolean>> {
  const admin = supabaseAdmin;
  if (!admin) return ALL_OPEN;
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.val;

  const entries = await Promise.all(
    (Object.entries(CAPPED_X_TASKS) as [CappedTaskKey, string][]).map(
      async ([key, col]) => {
        const { count, error } = await admin
          .from("waitlist")
          .select("wallet", { count: "exact", head: true })
          .not(col, "is", null);
        return [key, !error && (count ?? 0) >= X_TASK_CAP] as const;
      },
    ),
  );
  const val = { ...ALL_OPEN, ...Object.fromEntries(entries) } as Record<
    CappedTaskKey,
    boolean
  >;
  cache = { at: Date.now(), val };
  return val;
}
