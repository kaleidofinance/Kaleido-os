import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { readPlatformTotals } from "@/lib/stats/platform";
import { isErrorStatus } from "@/lib/analytics/agentStatus";

/**
 * The /analytics overview — headline KPIs across every Kaleido product, for the
 * public page. Each domain is independent and reads `null` when its source is
 * unavailable (a missing view mid-migration, or the DB key unset), so the page
 * renders what exists rather than a wall of zeros.
 *
 * Phase 1 aggregates in TypeScript from capped reads of the ledgers, which is
 * correct and cheap at launch volume; when the tables grow, the same shapes move
 * behind SQL rollup views (Phase 2) with no change to the page.
 */

export interface AnalyticsOverview {
  trading: {
    volumeUsd: number;
    feesUsd: number;
    swapCount: number | null;
    cctpBridgeCount: number | null;
    routeBridgeCount: number | null;
  } | null;
  growth: {
    uniqueWallets: number;
    waitlistMembers: number | null;
    referrals: number;
  } | null;
  luca: {
    turns: number;
    /** 1 - error rate: ok + refused + any non-error outcome. A safe decline is
     *  the agent working, not failing, so it counts as handled. */
    handledRate: number; // 0..1
    avgLatencyMs: number | null;
    /** Counts from the client-side route log; null when that table is unavailable. */
    localIntentTurns: number | null;
    localFollowUps: number | null;
    modelTurns: number | null;
  } | null;
  points: {
    totalPoints: number;
    bySource: Record<string, number>;
  } | null;
}

const READ_CAP = 100_000;

/* ------------------------------------------------------------ pure sums -- */

/** Fold point_actions rows into unique wallets, total points and per-source
 *  points. Pure, so it is tested without a database. */
export function summarizeActions(
  rows: ReadonlyArray<{
    wallet?: string | null;
    points?: number | string | null;
    source_slug?: string | null;
  }>,
): { uniqueWallets: number; totalPoints: number; bySource: Record<string, number> } {
  const wallets = new Set<string>();
  const bySource: Record<string, number> = {};
  let totalPoints = 0;
  for (const r of rows) {
    const w = (r?.wallet ?? "").toLowerCase();
    if (w) wallets.add(w);
    const p = Number(r?.points ?? 0);
    if (Number.isFinite(p) && p > 0) {
      totalPoints += p;
      const slug = r?.source_slug ?? "other";
      bySource[slug] = (bySource[slug] ?? 0) + p;
    }
  }
  return { uniqueWallets: wallets.size, totalPoints, bySource };
}

/** Fold agent_turns rows into count, HANDLED rate and average latency. Handled
 *  = 1 - error rate, so a `refused` (a correct decline) counts as handled, not a
 *  failure — see agentStatus.ts. Pure. */
export function summarizeTurns(
  rows: ReadonlyArray<{ status?: string | null; latency_ms?: number | null }>,
): { turns: number; handledRate: number; avgLatencyMs: number | null } {
  let errors = 0;
  let latencySum = 0;
  let latencyN = 0;
  for (const r of rows) {
    if (isErrorStatus(r?.status)) errors++;
    const l = Number(r?.latency_ms);
    if (Number.isFinite(l) && l > 0) {
      latencySum += l;
      latencyN++;
    }
  }
  const turns = rows.length;
  return {
    turns,
    handledRate: turns > 0 ? (turns - errors) / turns : 0,
    avgLatencyMs: latencyN > 0 ? Math.round(latencySum / latencyN) : null,
  };
}

/** Fold the privacy-preserving route log into the Luca usage split shown on
 * analytics. The log contains route labels only here; question text and wallet
 * hashes never leave this server-side aggregation. */
export function summarizeQuestionRoutes(
  rows: ReadonlyArray<{ route?: string | null }>,
): { localIntentTurns: number; localFollowUps: number; modelTurns: number } {
  let localIntentTurns = 0;
  let localFollowUps = 0;
  let modelTurns = 0;
  for (const row of rows) {
    const route = row?.route ?? "";
    if (route.startsWith("local-intent:")) {
      localIntentTurns++;
      if (route === "local-intent:follow_up") localFollowUps++;
    } else if (route === "model") {
      modelTurns++;
    }
  }
  return { localIntentTurns, localFollowUps, modelTurns };
}

function sumField(
  rows: ReadonlyArray<Record<string, unknown>>,
  field: string,
): number {
  let total = 0;
  for (const r of rows) {
    const n = Number(r?.[field] ?? 0);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

/* ------------------------------------------------------------- readers -- */

async function readTrading(): Promise<AnalyticsOverview["trading"]> {
  const totals = await readPlatformTotals();
  if (!totals) return null;
  return {
    volumeUsd: totals.volumeUsd,
    feesUsd: totals.feesUsd,
    swapCount: totals.breakdown.swapCount,
    cctpBridgeCount: totals.breakdown.cctpBridgeCount,
    routeBridgeCount: totals.breakdown.routeBridgeCount,
  };
}

async function readGrowth(): Promise<AnalyticsOverview["growth"]> {
  if (!supabaseAdmin) return null;
  try {
    const actions = await supabaseAdmin
      .from("point_actions")
      .select("wallet")
      .limit(READ_CAP);
    if (actions.error) return null;
    const uniqueWallets = new Set(
      (actions.data ?? []).map((r) => String((r as { wallet?: string }).wallet ?? "").toLowerCase()).filter(Boolean),
    ).size;

    const wl = await supabaseAdmin
      .from("waitlist")
      .select("*", { count: "exact", head: true });
    const waitlistMembers = wl.error ? null : (wl.count ?? 0);

    const refs = await supabaseAdmin
      .from("waitlist_leaderboard")
      .select("referrals")
      .limit(READ_CAP);
    const referrals = refs.error ? 0 : sumField(refs.data ?? [], "referrals");

    return { uniqueWallets, waitlistMembers, referrals };
  } catch {
    return null;
  }
}

async function readLuca(): Promise<AnalyticsOverview["luca"]> {
  if (!supabaseAdmin) return null;
  try {
    const [{ data, error }, routes] = await Promise.all([
      supabaseAdmin
      .from("agent_turns")
      .select("status, latency_ms")
      .limit(READ_CAP),
      supabaseAdmin.from("agent_questions").select("route").limit(READ_CAP),
    ]);
    if (error || !data) return null;
    const turns = summarizeTurns(data as { status?: string | null; latency_ms?: number | null }[]);
    const routeSummary = routes.error
      ? { localIntentTurns: null, localFollowUps: null, modelTurns: null }
      : summarizeQuestionRoutes(routes.data ?? []);
    return { ...turns, ...routeSummary };
  } catch {
    return null;
  }
}

async function readPoints(): Promise<AnalyticsOverview["points"]> {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("point_actions")
      .select("points, source_slug")
      .limit(READ_CAP);
    if (error || !data) return null;
    const { totalPoints, bySource } = summarizeActions(
      data as { points?: number | string | null; source_slug?: string | null }[],
    );
    return { totalPoints, bySource };
  } catch {
    return null;
  }
}

/** Assemble the overview. Domains that error read as null; the page copes. */
export async function readAnalyticsOverview(): Promise<AnalyticsOverview> {
  const [trading, growth, luca, points] = await Promise.all([
    readTrading(),
    readGrowth(),
    readLuca(),
    readPoints(),
  ]);
  return { trading, growth, luca, points };
}
