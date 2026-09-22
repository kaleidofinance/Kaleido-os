import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { isErrorStatus } from "@/lib/analytics/agentStatus";

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

export async function readAdminMetrics(): Promise<AdminMetrics> {
  const [agentHealth, quota] = await Promise.all([readAgentHealth(), readQuota()]);
  return { agentHealth, quota };
}
