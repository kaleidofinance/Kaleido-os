import type { SupabaseClient } from "@supabase/supabase-js";

import { eligibleTaskPoints, topUpOwed, topUpRow, X_TASK_COLUMNS, type TaskRow } from "./eligible";

/**
 * Keep every wallet's Season 1 task credit level with its /rewards card.
 *
 * The card computes task points live; the leaderboard reads the Season 1 ledger.
 * The ledger used to be topped up only inside the Rewards GET — so a wallet that
 * earned a referral, cleared an X-task hold or crossed a swap-volume tier sat
 * BELOW its card on the leaderboard until that wallet itself opened Rewards.
 * This runs the same calculation (eligible.ts) for every wallet from the
 * activation job's clock, so the two differ by at most one run.
 *
 * Bulk by design: a handful of paged reads for the whole waitlist, then one
 * insert per chunk of top-ups — not a per-wallet round trip, which would not fit
 * the job's 60s budget at ~9k wallets.
 */

const PAGE = 1000;

async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export interface PlannedTopUp {
  wallet: string;
  eligible: number;
  delta: number;
}

/**
 * Who is owed how much, from already-fetched facts. Pure — the whole decision
 * lives here so it is tested without a database.
 */
export function planTopUps(args: {
  rows: (TaskRow & { wallet: string; activated_at?: string | null })[];
  referrals: Map<string, number>;
  credited: Map<string, number>;
  swapVolumeUsd: Map<string, number>;
  now: number;
}): PlannedTopUp[] {
  const out: PlannedTopUp[] = [];
  for (const row of args.rows) {
    const wallet = row.wallet.toLowerCase();
    const eligible = eligibleTaskPoints({
      row,
      referrals: args.referrals.get(wallet) ?? 0,
      swapVolumeUsd: args.swapVolumeUsd.get(wallet) ?? 0,
      now: args.now,
    });
    const delta = topUpOwed({
      eligible,
      credited: args.credited.get(wallet) ?? 0,
      activated: Boolean(row.activated_at),
    });
    if (delta > 0) out.push({ wallet, eligible, delta });
  }
  return out;
}

const sumBy = (rows: { wallet: string }[], value: (r: never) => number) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const w = r.wallet.toLowerCase();
    m.set(w, (m.get(w) ?? 0) + value(r as never));
  }
  return m;
};

/** Every fact the plan needs, in bulk. Read-only — the dry run uses it alone. */
export async function loadSyncFacts(admin: SupabaseClient) {
  const cols = [
    "wallet",
    "welcome_points",
    "activated_at",
    "arc_mainnet_tx_at",
    "agent_tx_at",
    "bridge_tx_at",
    ...Object.values(X_TASK_COLUMNS),
  ].join(", ");

  const [rows, lb, credits, swaps] = await Promise.all([
    pageAll<TaskRow & { wallet: string; activated_at: string | null }>((a, b) =>
      admin.from("waitlist").select(cols).order("wallet").range(a, b) as never,
    ),
    pageAll<{ wallet: string; referrals: number | null }>((a, b) =>
      admin.from("waitlist_leaderboard").select("wallet, referrals").order("wallet").range(a, b) as never,
    ),
    pageAll<{ wallet: string; points: number | string }>((a, b) =>
      admin
        .from("point_actions")
        .select("wallet, points")
        .eq("source_slug", "waitlist")
        .eq("season", 1)
        .order("id")
        .range(a, b) as never,
    ),
    pageAll<{ wallet: string; usd_value: number | string | null }>((a, b) =>
      admin
        .from("point_actions")
        .select("wallet, usd_value")
        .eq("source_slug", "swap")
        .eq("season", 1)
        .order("id")
        .range(a, b) as never,
    ),
  ]);

  const referrals = new Map(lb.map((r) => [r.wallet.toLowerCase(), Number(r.referrals ?? 0)]));
  const credited = sumBy(credits, (r: { points: number | string }) => Number(r.points ?? 0));
  const swapVolumeUsd = sumBy(swaps, (r: { usd_value: number | string | null }) => Number(r.usd_value ?? 0));
  return { rows, referrals, credited, swapVolumeUsd };
}

/** Read everything, plan, write the top-ups. Returns counts for the job log. */
export async function syncWaitlistCredits(
  admin: SupabaseClient,
  now = Date.now(),
): Promise<{ wallets: number; toppedUp: number; points: number; errors: string[] }> {
  const { rows, referrals, credited, swapVolumeUsd } = await loadSyncFacts(admin);
  const plan = planTopUps({ rows, referrals, credited, swapVolumeUsd, now });
  const at = new Date(now).toISOString();
  const errors: string[] = [];
  let toppedUp = 0;
  let points = 0;

  // Chunked inserts. A chunk that hits the idempotency key (23505 — another run
  // already wrote one of these top-ups) is retried row by row so the rest land.
  for (let i = 0; i < plan.length; i += 200) {
    const chunk = plan.slice(i, i + 200);
    const { error } = await admin
      .from("point_actions")
      .insert(chunk.map((p) => topUpRow(p.wallet, p.eligible, p.delta, at)));
    if (!error) {
      toppedUp += chunk.length;
      points += chunk.reduce((s, p) => s + p.delta, 0);
      continue;
    }
    for (const p of chunk) {
      const { error: one } = await admin
        .from("point_actions")
        .insert(topUpRow(p.wallet, p.eligible, p.delta, at));
      if (!one) {
        toppedUp++;
        points += p.delta;
      } else if ((one as { code?: string }).code !== "23505") {
        errors.push(`topup:${p.wallet}`);
      }
    }
  }
  return { wallets: rows.length, toppedUp, points, errors };
}
