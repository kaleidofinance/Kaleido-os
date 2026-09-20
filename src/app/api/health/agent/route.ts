import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { getProviderChain } from "@/lib/ai";
import { GLOBAL_DAILY_MODEL_REQUESTS } from "@/lib/ai/credits";
import { supabaseAdmin } from "@/lib/supabase/serverClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Operational health of the Luca agent path — the endpoint a scheduler pings so
 * the team hears of an outage before its users do.
 *
 * WHAT IT ANSWERS, and why each was blind before:
 *  - `providers`: which model backends are configured, and the primary. A
 *    rotated or deleted key leaves this empty, which used to look identical to a
 *    provider outage; here they are plainly different (`ok:false`, count 0).
 *  - `metered`: whether the quota counter is actually running (a missing service
 *    key makes /api/chat fail open — unbounded provider spend — with only a
 *    console line to show for it).
 *  - `globalQuota`: how much of the shared daily ceiling is left, and whether it
 *    is throttled. The counter lived in Postgres with no read path from the app.
 *  - `lastGoodTurnAt` / `window1h`: the newest successful turn and the last
 *    hour's failure rate, from the agent_turns log — "is it answering, and how
 *    often is it failing", which nothing could report.
 *
 * GUARDED like the keeper and health-watch routes: `Authorization: Bearer
 * $CRON_SECRET` or `X-Keeper-Secret`, one credential for the deployment's own
 * jobs. With no CRON_SECRET it refuses, since the response names configuration.
 * It reads only; it spends no gas and no quota.
 */

function secretMatches(candidate: string | null, secret: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  if (a.length !== b.length) {
    // Compare against itself so the timing does not leak the length.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function authorised(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (secretMatches(bearer, secret)) return true;
  return secretMatches(request.headers.get("x-keeper-secret"), secret);
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FAILURE_ALERT_RATE = 0.05;
const LOW_CONFIDENCE_ALERT = 0.8;
const MIN_CLASSIFIED_FOR_CONFIDENCE_ALERT = 5;

async function handle(request: NextRequest) {
  // Trimmed to match the trimmed bearer — a trailing newline in the Vercel env
  // var would otherwise fail the length check and 401 forever.
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "The agent health endpoint is not enabled." },
      { status: 503 },
    );
  }
  if (!authorised(request, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  /* The configured chain, primary first. Its length is the whole "does Luca have
     a brain" question: zero means no key reached this deployment. */
  const chain = getProviderChain().map((p) => p.id);
  const metered = !!supabaseAdmin;

  /* Global quota headroom + the last successful turn + the last hour's failure
     rate, each best-effort: a read that fails degrades to null rather than
     failing the health check, since "couldn't read" is itself worth seeing. */
  let globalQuota: {
    used: number;
    cap: number;
    remaining: number;
    throttledAt: string | null;
  } | null = null;
  let lastGoodTurnAt: string | null = null;
  let window1h: { total: number; failures: number; failureRate: number } | null =
    null;
  let jev: {
    windowHours: number;
    total: number;
    classified: number;
    averageConfidence: number | null;
    skippedNormalizer: number;
    skippedRate: number;
    routes: Record<string, number>;
  } | null = null;

  if (supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin.rpc("peek_global_agent_usage");
      const row = Array.isArray(data) ? data[0] : data;
      if (row && typeof row === "object") {
        const used = Number((row as { used?: unknown }).used ?? 0);
        /* The RPC returns (used, throttled_at) only; the cap is the app's own
           deployment ceiling constant, the same number consume passes in. */
        globalQuota = {
          used,
          cap: GLOBAL_DAILY_MODEL_REQUESTS,
          remaining: Math.max(0, GLOBAL_DAILY_MODEL_REQUESTS - used),
          throttledAt:
            ((row as { throttled_at?: unknown }).throttled_at as string) ??
            null,
        };
      }
    } catch {
      /* RPC missing or unreachable — reported as null. */
    }

    try {
      const { data } = await supabaseAdmin
        .from("agent_turns")
        .select("created_at")
        .eq("status", "ok")
        .order("created_at", { ascending: false })
        .limit(1);
      const row = Array.isArray(data) ? data[0] : null;
      lastGoodTurnAt =
        (row && (row as { created_at?: string }).created_at) || null;
    } catch {
      /* Table unapplied or unreachable — null. */
    }

    try {
      const since = new Date(Date.now() - HOUR_MS).toISOString();
      const { data } = await supabaseAdmin
        .from("agent_turns")
        .select("status")
        .gte("created_at", since);
      if (Array.isArray(data)) {
        const total = data.length;
        const failures = data.filter((r) =>
          ["provider_error", "provider_blocked"].includes(
            (r as { status: string }).status,
          ),
        ).length;
        window1h = {
          total,
          failures,
          failureRate: total > 0 ? failures / total : 0,
        };
      }
    } catch {
      /* null. */
    }

    try {
      /* Jev is operational telemetry, so aggregate it here rather than
         exposing individual turns. The endpoint is already CRON_SECRET-gated
         and this keeps the response free of prompts, plans, and wallet data. */
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const { data } = await supabaseAdmin
        .from("agent_turns")
        .select("jev_route,jev_confidence,jev_normalizer_skipped")
        .gte("created_at", since);
      if (Array.isArray(data)) {
        const routes: Record<string, number> = {};
        let classified = 0;
        let confidenceTotal = 0;
        let confidenceCount = 0;
        let skippedNormalizer = 0;
        for (const row of data) {
          const route =
            typeof row.jev_route === "string" ? row.jev_route : null;
          if (route) {
            classified += 1;
            routes[route] = (routes[route] ?? 0) + 1;
          }
          const confidence = Number(row.jev_confidence);
          if (Number.isFinite(confidence)) {
            confidenceTotal += confidence;
            confidenceCount += 1;
          }
          if (row.jev_normalizer_skipped === true) skippedNormalizer += 1;
        }
        jev = {
          windowHours: 24,
          total: data.length,
          classified,
          averageConfidence:
            confidenceCount > 0 ? confidenceTotal / confidenceCount : null,
          skippedNormalizer,
          skippedRate:
            data.length > 0 ? skippedNormalizer / data.length : 0,
          routes,
        };
      }
    } catch {
      /* Migration missing or unreachable — null, without degrading health. */
    }
  }

  const alerts: string[] = [];
  if (window1h && window1h.total >= 5 && window1h.failureRate > FAILURE_ALERT_RATE) {
    alerts.push("agent_failure_rate_high");
  }
  if (
    jev &&
    jev.classified >= MIN_CLASSIFIED_FOR_CONFIDENCE_ALERT &&
    jev.averageConfidence !== null &&
    jev.averageConfidence < LOW_CONFIDENCE_ALERT
  ) {
    alerts.push("jev_confidence_low");
  }

  const ok = chain.length > 0 && metered && alerts.length === 0;

  return NextResponse.json({
    ok,
    providers: { primary: chain[0] ?? null, chain, count: chain.length },
    metered,
    globalQuota,
    lastGoodTurnAt,
    window1h,
    jev,
    alerts,
    checkedAt: new Date().toISOString(),
  }, { status: ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}
