import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { isErrorStatus } from "@/lib/analytics/agentStatus";
import { providerForChain } from "@/config/provider";
import { swapFeeReceiver } from "@/lib/swap/kyberswapServer";

/** Arc mainnet — where swaps are credited (see api/cron/points-swap). */
const ARC_CHAIN_ID = 5042;

/**
 * Admin-only ops metrics for /analytics/admin — the signals that don't belong on
 * a public page: the agent's real status breakdown (a "refused" is a correct
 * decline, NOT a failure — the reason a public "success rate" undercounts),
 * failover and latency, provider mix, and today's quota usage.
 */

export interface AdminMetrics {
  agentHealth: {
    total: number;
    byStatus: Record<string, number>;
    okRate: number;
    errorRate: number;
    failoverRate: number;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    providerMix: Record<string, number>;
  } | null;
  quota: {
    requestsToday: number;
    walletsToday: number;
    topWalletsToday: { wallet: string; requests: number }[];
  } | null;
  /**
   * Swap-credit pipeline health — the promo lifeline. The waitlist swap-volume
   * tasks only complete when the points-swap cron credits a swap, so this is
   * where "swaps stopped crediting" or "the cron is falling behind" shows up.
   */
  swapPipeline: {
    /** Latest credited swap, ever. Stale = the pipeline may have stopped. */
    lastCreditAt: string | null;
    lastCreditAgeSec: number | null;
    credits24h: number;
    credits7d: number;
    volume24hUsd: number;
    /** points_swap_cursor: how far the indexer has read, and when it last ran. */
    cursorBlock: number | null;
    cursorUpdatedAt: string | null;
    cursorAgeSec: number | null;
    /** Chain head now, and how many blocks the cursor is behind it (lag). */
    headBlock: number | null;
    blocksBehind: number | null;
    /** SWAP_FEE_RECEIVER configured — without it the cron credits nothing. */
    feeArmed: boolean;
  } | null;
}

export interface HealthRow {
  status?: string | null;
  latency_ms?: number | null;
  failed_over?: boolean | null;
  provider?: string | null;
}

/** Fold agent_turns into the health panel. Pure. */
export function summarizeHealth(rows: ReadonlyArray<HealthRow>): NonNullable<AdminMetrics["agentHealth"]> {
  const total = rows.length;
  const byStatus: Record<string, number> = {};
  const providerMix: Record<string, number> = {};
  let ok = 0;
  let errors = 0;
  let failovers = 0;
  const latencies: number[] = [];
  for (const r of rows) {
    const st = r.status ?? "unknown";
    byStatus[st] = (byStatus[st] ?? 0) + 1;
    if (st === "ok") ok++;
    if (isErrorStatus(st)) errors++;
    if (r.failed_over === true) failovers++;
    const prov = r.provider ?? "unknown";
    providerMix[prov] = (providerMix[prov] ?? 0) + 1;
    const l = Number(r.latency_ms);
    if (Number.isFinite(l) && l > 0) latencies.push(l);
  }
  latencies.sort((a, b) => a - b);
  const avg = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;
  const p95 = latencies.length
    ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]
    : null;
  return {
    total,
    byStatus,
    okRate: total ? ok / total : 0,
    errorRate: total ? errors / total : 0,
    failoverRate: total ? failovers / total : 0,
    avgLatencyMs: avg,
    p95LatencyMs: p95,
    providerMix,
  };
}

export interface QuotaRow {
  wallet?: string | null;
  requests?: number | string | null;
}

/** Fold today's agent_usage_daily into the quota panel. Pure. */
export function summarizeQuota(rows: ReadonlyArray<QuotaRow>): NonNullable<AdminMetrics["quota"]> {
  let requestsToday = 0;
  const wallets = new Set<string>();
  const ranked: { wallet: string; requests: number }[] = [];
  for (const r of rows) {
    const n = Number(r.requests ?? 0);
    const w = (r.wallet ?? "").toLowerCase();
    if (w) wallets.add(w);
    if (Number.isFinite(n) && n > 0) {
      requestsToday += n;
      if (w) ranked.push({ wallet: w, requests: n });
    }
  }
  ranked.sort((a, b) => b.requests - a.requests);
  return {
    requestsToday,
    walletsToday: wallets.size,
    topWalletsToday: ranked.slice(0, 10),
  };
}

export interface SwapCreditRow {
  occurred_at?: string | null;
  usd_value?: number | string | null;
}

/**
 * Fold recent `swap` point_actions into credit counts + 24h volume. Pure. `nowMs`
 * is injected so the windows are testable. Rows outside 7d are ignored by the
 * caller's query; anything older here simply falls outside both windows.
 */
export function summarizeSwapCredits(
  rows: ReadonlyArray<SwapCreditRow>,
  nowMs: number,
): { credits24h: number; credits7d: number; volume24hUsd: number } {
  const DAY = 86_400_000;
  let credits24h = 0;
  let credits7d = 0;
  let volume24hUsd = 0;
  for (const r of rows) {
    const t = r.occurred_at ? Date.parse(r.occurred_at) : NaN;
    if (!Number.isFinite(t)) continue;
    const age = nowMs - t;
    if (age <= 7 * DAY) credits7d++;
    if (age <= DAY) {
      credits24h++;
      const v = Number(r.usd_value ?? 0);
      if (Number.isFinite(v) && v > 0) volume24hUsd += v;
    }
  }
  return { credits24h, credits7d, volume24hUsd };
}

const READ_CAP = 100_000;

async function readAgentHealth(): Promise<AdminMetrics["agentHealth"]> {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("agent_turns")
      .select("status, latency_ms, failed_over, provider")
      .limit(READ_CAP);
    if (error || !data) return null;
    return summarizeHealth(data as HealthRow[]);
  } catch {
    return null;
  }
}

async function readQuota(): Promise<AdminMetrics["quota"]> {
  if (!supabaseAdmin) return null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabaseAdmin
      .from("agent_usage_daily")
      .select("wallet, requests")
      .eq("usage_date", today)
      .limit(READ_CAP);
    if (error || !data) return null;
    return summarizeQuota(data as QuotaRow[]);
  } catch {
    return null;
  }
}

async function readSwapPipeline(): Promise<AdminMetrics["swapPipeline"]> {
  if (!supabaseAdmin) return null;
  const admin = supabaseAdmin;
  try {
    const now = Date.now();
    const since = new Date(now - 7 * 86_400_000).toISOString();

    // Counts + 24h volume over the last 7 days (bounded).
    const { data: recent } = await admin
      .from("point_actions")
      .select("occurred_at, usd_value")
      .eq("source_slug", "swap")
      .gte("occurred_at", since)
      .limit(READ_CAP);
    const folded = summarizeSwapCredits((recent ?? []) as SwapCreditRow[], now);

    /* 24h VOLUME from the volume ledger — every swap, not just credited ones
       (a credit needs ≥ min_usd). Credit counts above stay on point_actions:
       they measure the points pipeline. Ledger unreadable → credited volume. */
    const { data: ledgerRows, error: ledgerErr } = await admin
      .from("swap_volume")
      .select("occurred_at, usd_value")
      .eq("chain_id", ARC_CHAIN_ID)
      .gte("occurred_at", since)
      .limit(READ_CAP);
    const volume24hUsd = ledgerErr
      ? folded.volume24hUsd
      : summarizeSwapCredits((ledgerRows ?? []) as SwapCreditRow[], now)
          .volume24hUsd;

    // The absolute latest credit (may be older than 7d — that itself is a
    // signal), so "last credit age" is always accurate.
    const { data: last } = await admin
      .from("point_actions")
      .select("occurred_at")
      .eq("source_slug", "swap")
      .order("occurred_at", { ascending: false })
      .limit(1);
    const lastAt = last?.[0]?.occurred_at ? String(last[0].occurred_at) : null;
    const lastMs = lastAt ? Date.parse(lastAt) : NaN;
    const lastCreditAgeSec = Number.isFinite(lastMs)
      ? Math.max(0, Math.round((now - lastMs) / 1000))
      : null;

    // Cursor position + freshness.
    const { data: cur } = await admin
      .from("points_swap_cursor")
      .select("last_block, updated_at")
      .eq("chain_id", ARC_CHAIN_ID)
      .maybeSingle();
    const cursorBlock = cur ? Number(cur.last_block) : null;
    const cursorUpdatedAt = cur?.updated_at ? String(cur.updated_at) : null;
    const cursorAgeSec = cursorUpdatedAt
      ? Math.max(0, Math.round((now - Date.parse(cursorUpdatedAt)) / 1000))
      : null;

    // Chain head now, best-effort — an RPC hiccup leaves lag unknown, not wrong.
    let headBlock: number | null = null;
    try {
      const provider = providerForChain(ARC_CHAIN_ID);
      if (provider) headBlock = await provider.getBlockNumber();
    } catch {
      headBlock = null;
    }
    const blocksBehind =
      headBlock !== null && cursorBlock !== null
        ? Math.max(0, headBlock - cursorBlock)
        : null;

    return {
      lastCreditAt: lastAt,
      lastCreditAgeSec,
      credits24h: folded.credits24h,
      credits7d: folded.credits7d,
      volume24hUsd,
      cursorBlock: cursorBlock !== null && Number.isFinite(cursorBlock) ? cursorBlock : null,
      cursorUpdatedAt,
      cursorAgeSec,
      headBlock,
      blocksBehind,
      feeArmed: !!swapFeeReceiver(),
    };
  } catch {
    return null;
  }
}

export async function readAdminMetrics(): Promise<AdminMetrics> {
  const [agentHealth, quota, swapPipeline] = await Promise.all([
    readAgentHealth(),
    readQuota(),
    readSwapPipeline(),
  ]);
  return { agentHealth, quota, swapPipeline };
}
