import { summarizeSwapTotals } from "./swapTotals";
import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { readPlatformTotals } from "@/lib/stats/platform";
import { swapFeeBps } from "@/lib/swap/kyberswapServer";
import { lifiFeeRate } from "@/lib/stats/platform";
import { isErrorStatus } from "@/lib/analytics/agentStatus";
import { readExternalPools, type ExternalPoolSnapshot } from "@/lib/market/externalPools";
import { ANALYTICS_MAINNET_CHAIN_IDS, EXTERNAL_MARKET_CHAIN_IDS } from "./scope";

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
  externalMarkets: ExternalPoolSnapshot[];
  trading: {
    volumeUsd: number;
    feesUsd: number;
    swapCount: number | null;
    cctpBridgeCount: number | null;
    routeBridgeCount: number | null;
    /** True when a volume source was unavailable, so the totals understate —
     *  the page names it rather than showing an understated sum as complete. */
    partial: boolean;
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

async function readTrading(chainId?: number): Promise<AnalyticsOverview["trading"]> {
  if (chainId !== undefined) {
    if (!supabaseAdmin) return null;
    const [swaps, cctp, routes, native] = await Promise.all([
      supabaseAdmin.from("swap_volume").select("tx_hash,usd_value,fee_paid").eq("chain_id", chainId).limit(READ_CAP),
      supabaseAdmin.from("cctp_transfers").select("amount").eq("source_chain_id", chainId).neq("status", "failed").limit(READ_CAP),
      supabaseAdmin.from("route_bridges").select("usd_value").eq("source_chain_id", chainId).limit(READ_CAP),
      supabaseAdmin.from("pool_volume").select("tx_hash,usd_value").eq("chain_id", chainId).limit(READ_CAP),
    ]);
    if (swaps.error && cctp.error && routes.error && native.error) return null;
    const swapRows = swaps.error ? [] : swaps.data ?? [];
    const swapTotals = summarizeSwapTotals(swapRows, native.error ? [] : native.data ?? []);
    const routeVolume = routes.error ? 0 : sumField(routes.data ?? [], "usd_value");
    return {
      volumeUsd: swapTotals.volumeUsd + (cctp.error ? 0 : sumField(cctp.data ?? [], "amount")) + routeVolume,
      feesUsd: swapTotals.feeVolumeUsd * swapFeeBps() / 10000 + routeVolume * lifiFeeRate(),
      swapCount: swaps.error && native.error ? null : swapTotals.swapCount,
      cctpBridgeCount: cctp.error ? null : cctp.data?.length ?? 0,
      routeBridgeCount: routes.error ? null : routes.data?.length ?? 0,
      partial: Boolean(swaps.error || cctp.error || routes.error || native.error || swapTotals.partial || (native.data?.length ?? 0) >= READ_CAP || swapRows.length >= READ_CAP || (cctp.data?.length ?? 0) >= READ_CAP || (routes.data?.length ?? 0) >= READ_CAP),
    };
  }
  const totals = await readPlatformTotals();
  if (!totals) return null;
  return {
    volumeUsd: totals.volumeUsd,
    feesUsd: totals.feesUsd,
    swapCount: totals.breakdown.swapCount,
    cctpBridgeCount: totals.breakdown.cctpBridgeCount,
    routeBridgeCount: totals.breakdown.routeBridgeCount,
    partial: totals.partial,
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
export async function readAnalyticsOverview(chainId?: number): Promise<AnalyticsOverview> {
  const externalChainIds = EXTERNAL_MARKET_CHAIN_IDS.filter((id) => chainId === undefined || chainId === id);
  const [trading, growth, luca, points, externalMarkets] = await Promise.all([
    chainId === undefined ? Promise.all(ANALYTICS_MAINNET_CHAIN_IDS.map((id) => readTrading(id))).then((parts) => {
      const known = parts.filter((part): part is NonNullable<AnalyticsOverview["trading"]> => part !== null);
      if (!known.length) return null;
      const count = (key: "swapCount" | "cctpBridgeCount" | "routeBridgeCount") => known.every((part) => part[key] === null) ? null : known.reduce((total, part) => total + (part[key] ?? 0), 0);
      return { volumeUsd: known.reduce((total, part) => total + part.volumeUsd, 0), feesUsd: known.reduce((total, part) => total + part.feesUsd, 0), swapCount: count("swapCount"), cctpBridgeCount: count("cctpBridgeCount"), routeBridgeCount: count("routeBridgeCount"), partial: known.length !== parts.length || known.some((part) => part.partial) };
    }) : readTrading(chainId),
    readGrowth(),
    readLuca(),
    readPoints(),
    Promise.all(externalChainIds.map((id) => readExternalPools(id))).then((snapshots) =>
      snapshots.filter((snapshot): snapshot is ExternalPoolSnapshot => snapshot !== null),
    ),
  ]);
  return { trading, growth, luca, points, externalMarkets };
}
