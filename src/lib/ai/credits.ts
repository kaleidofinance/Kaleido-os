import { supabaseAdmin } from "@/lib/supabase/serverClient";

/**
 * Model request quota.
 *
 * Rations the one expensive thing in the agent: a provider call. It is not a
 * cap on what a user may transact — a typed command builds and signs a plan
 * locally at zero cost and never touches this module. The user's own funds are
 * their business; a shared provider bill is not.
 *
 * Server-only, and deliberately so. A browser-side counter is decoration: the
 * anon key ships in the bundle, so anything the client can increment it can
 * also decline to increment.
 */

/** Requests per wallet per UTC day. */
export const DAILY_MODEL_REQUESTS = Number(
  process.env.AGENT_DAILY_MODEL_REQUESTS || 25,
);

export interface QuotaState {
  used: number;
  quota: number;
  remaining: number;
}

export interface QuotaDecision extends QuotaState {
  allowed: boolean;
  /** True when quota is not being enforced at all (unconfigured Supabase). */
  unmetered: boolean;
}

const unmetered = (): QuotaDecision => ({
  allowed: true,
  used: 0,
  quota: DAILY_MODEL_REQUESTS,
  remaining: DAILY_MODEL_REQUESTS,
  unmetered: true,
});

/**
 * Spends one request. Call immediately before dispatching to a provider, never
 * on entry to the route, or locally-answered turns would burn quota and defeat
 * the point of routing locally first.
 */
export async function consumeModelRequest(
  wallet: string | undefined,
): Promise<QuotaDecision> {
  // No wallet means no identity to meter, and metering by IP is trivially
  // defeated. Rather than hand out free provider calls to anyone unauthenticated,
  // the route treats this as "local only" and says so.
  if (!wallet) {
    return {
      allowed: false,
      used: 0,
      quota: DAILY_MODEL_REQUESTS,
      remaining: 0,
      unmetered: false,
    };
  }

  // Unconfigured Supabase disables metering rather than blocking the feature,
  // matching how the rest of the app degrades. Deployments that care must set
  // the service-role key.
  if (!supabaseAdmin) return unmetered();

  const { data, error } = await supabaseAdmin.rpc("consume_agent_request", {
    p_wallet: wallet,
    p_limit: DAILY_MODEL_REQUESTS,
  });

  if (error) {
    // Failing open is the deliberate choice: a quota outage should not take the
    // agent down. It is logged loudly because sustained failure means the
    // ceiling is not being enforced.
    console.error("[credits] consume_agent_request failed:", error.message);
    return unmetered();
  }

  const row = Array.isArray(data) ? data[0] : data;
  const used = Number(row?.used ?? 0);
  const quota = Number(row?.quota ?? DAILY_MODEL_REQUESTS);

  return {
    allowed: Boolean(row?.allowed),
    used,
    quota,
    remaining: Math.max(0, quota - used),
    unmetered: false,
  };
}

/** Reads today's usage without spending any. Safe to call on page load. */
export async function peekModelUsage(
  wallet: string | undefined,
): Promise<QuotaState> {
  const empty = {
    used: 0,
    quota: DAILY_MODEL_REQUESTS,
    remaining: DAILY_MODEL_REQUESTS,
  };
  if (!wallet || !supabaseAdmin) return empty;

  const { data, error } = await supabaseAdmin.rpc("peek_agent_usage", {
    p_wallet: wallet,
  });
  if (error) {
    console.error("[credits] peek_agent_usage failed:", error.message);
    return empty;
  }

  const row = Array.isArray(data) ? data[0] : data;
  const used = Number(typeof row === "object" ? (row?.used ?? 0) : (row ?? 0));
  return {
    used,
    quota: DAILY_MODEL_REQUESTS,
    remaining: Math.max(0, DAILY_MODEL_REQUESTS - used),
  };
}
