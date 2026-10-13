import { supabaseAdmin } from "@/lib/supabase/serverClient";

/**
 * Per-IP rate limit for the chat endpoint — the abuse floor in front of an
 * endpoint whose quota identity (a wallet address) the caller does not have to
 * own. See supabase/migrations/20260914000000_agent_ip_rate.sql.
 *
 * FAILS OPEN, deliberately and like the quota: no IP to key on, no store, or a
 * limiter error all resolve to "allowed", because a limiter outage taking the
 * whole agent down would be a worse failure than a brief window without a floor.
 * Every such case is logged, and the per-wallet and deployment caps still sit
 * behind this.
 */

const IP_LIMIT = Number(process.env.AGENT_IP_RATE_LIMIT || 20);
const IP_WINDOW_SECONDS = Number(process.env.AGENT_IP_RATE_WINDOW_SECONDS || 60);

export interface IpRateDecision {
  allowed: boolean;
  hits: number;
  /** False when nothing could be checked (no IP or no store). */
  metered: boolean;
}

export async function checkIpRate(ip: string | null): Promise<IpRateDecision> {
  if (!ip || !supabaseAdmin) return { allowed: true, hits: 0, metered: false };
  try {
    const { data, error } = await supabaseAdmin.rpc("bump_ip_rate", {
      p_ip: ip,
      p_limit: IP_LIMIT,
      p_window_seconds: IP_WINDOW_SECONDS,
    });
    if (error) {
      console.error("[ipRate] bump_ip_rate failed:", error.message);
      return { allowed: true, hits: 0, metered: false };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: Boolean(row?.allowed ?? true),
      hits: Number(row?.hits ?? 0),
      metered: true,
    };
  } catch (err) {
    console.error("[ipRate]", (err as Error).message);
    return { allowed: true, hits: 0, metered: false };
  }
}

/**
 * The caller's IP, as the platform reports it.
 *
 * Prefers `x-real-ip`, which Vercel's edge sets to the single real client IP and
 * a caller cannot override; falls back to the left-most `x-forwarded-for` for
 * other hosts and local runs. Returns null when neither is present, which the
 * limiter reads as "cannot rate-limit" rather than as one shared bucket.
 */
export function clientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || null;
}
