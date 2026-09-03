import { supabaseAdmin } from "@/lib/supabase/serverClient";

/**
 * Model request quota.
 *
 * Rations the one expensive thing in the agent: a provider call. It is not a
 * cap on what a user may transact — a typed command builds and signs a plan
 * locally at zero cost and never touches this module. The user's own funds are
 * their business; a shared provider bill is not.
 *
 * TWO CEILINGS, AND THEY ANSWER DIFFERENT QUESTIONS. The per-wallet one asks
 * "is this person taking more than their share"; the deployment-wide one asks
 * "can we afford today". Only the second bounds the bill, because the first is
 * metered by an identity that is free to mint — `Wallet.createRandom()` in a
 * loop yields 25 more requests each — so per-wallet alone multiplies out to
 * whatever number of wallets someone cares to generate.
 *
 * Server-only, and deliberately so. A browser-side counter is decoration: the
 * anon key ships in the bundle, so anything the client can increment it can
 * also decline to increment.
 */

/** Requests per wallet per UTC day. */
export const DAILY_MODEL_REQUESTS = Number(
  process.env.AGENT_DAILY_MODEL_REQUESTS || 25,
);

/**
 * Requests across every wallet per UTC day — the ceiling on the bill.
 *
 * 2,000 is 80 wallets spending the full per-wallet 25, or a few hundred people
 * having a normal conversation, against a registration list of ~3,000. It is set
 * generously relative to honest use and tightly relative to the 76,925 that the
 * per-wallet ceiling alone permits that list.
 *
 * It is first-come, first-served, and that is worth knowing before raising it:
 * the fix for "someone drained it by 03:00 UTC" is to lower
 * DAILY_MODEL_REQUESTS, which is the only thing bounding one identity's share of
 * this number (25/2000 = 1.25%). Raising this one buys the same script a bigger
 * budget.
 */
export const GLOBAL_DAILY_MODEL_REQUESTS = Number(
  process.env.AGENT_GLOBAL_DAILY_MODEL_REQUESTS || 2000,
);

/**
 * How full the shared allowance has to be before it says so.
 *
 * The point is to hear about it while there is still a day's warning, because
 * the remedy — raise the ceiling, or lower the per-wallet one — is a deploy, and
 * the alternative signal is users reporting that Luca stopped answering.
 */
const GLOBAL_WARN_RATIO = 0.8;

/** Which ceiling turned a request away. */
export type QuotaRefusal =
  /** No wallet connected, so there is no identity to meter. */
  | "anonymous"
  /** This wallet has spent its own daily allowance. */
  | "wallet"
  /** The deployment has spent its allowance; this wallet has not. */
  | "global";

export interface QuotaState {
  used: number;
  quota: number;
  remaining: number;
}

export interface QuotaDecision extends QuotaState {
  allowed: boolean;
  /** True when quota is not being enforced at all (unconfigured Supabase). */
  unmetered: boolean;
  /**
   * Set only on a refusal, and the caller has to branch on it. `used`, `quota`
   * and `remaining` always describe THE WALLET, including on a `"global"`
   * refusal — because on that branch the wallet's request was handed straight
   * back and its allowance really is untouched. Reporting the shared numbers
   * there would tell someone who has asked two questions that they are out.
   */
  refusedBy?: QuotaRefusal;
  /** The shared counter as of this call. Operational; not for the credits pill. */
  global: { used: number; quota: number };
}

const unmetered = (): QuotaDecision => ({
  allowed: true,
  used: 0,
  quota: DAILY_MODEL_REQUESTS,
  remaining: DAILY_MODEL_REQUESTS,
  unmetered: true,
  global: { used: 0, quota: GLOBAL_DAILY_MODEL_REQUESTS },
});

/**
 * Spends one request against both ceilings. Call immediately before dispatching
 * to a provider, never on entry to the route, or locally-answered turns would
 * burn quota and defeat the point of routing locally first.
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
      refusedBy: "anonymous",
      global: { used: 0, quota: GLOBAL_DAILY_MODEL_REQUESTS },
    };
  }

  // Unconfigured Supabase disables metering rather than blocking the feature,
  // matching how the rest of the app degrades. Deployments that care must set
  // the service-role key. Worth being blunt about: this disables the shared
  // ceiling too, so an unconfigured deployment has no bound on provider spend at
  // all — see .env.example, which says so beside the key.
  if (!supabaseAdmin) return unmetered();

  const { data, error } = await supabaseAdmin.rpc("consume_agent_request", {
    p_wallet: wallet,
    p_limit: DAILY_MODEL_REQUESTS,
    p_global_limit: GLOBAL_DAILY_MODEL_REQUESTS,
  });

  if (error) {
    // Failing open is the deliberate choice: a quota outage should not take the
    // agent down. It is logged loudly because sustained failure means neither
    // ceiling is being enforced.
    console.error("[credits] consume_agent_request failed:", error.message);
    return unmetered();
  }

  const row = Array.isArray(data) ? data[0] : data;
  const used = Number(row?.used ?? 0);
  const quota = Number(row?.quota ?? DAILY_MODEL_REQUESTS);
  const globalUsed = Number(row?.global_used ?? 0);
  const globalQuota = Number(row?.global_quota ?? GLOBAL_DAILY_MODEL_REQUESTS);
  const allowed = Boolean(row?.allowed);

  /* `refused_by` is trusted only as one of the three values the function can
     return, because a stale deployment of the SQL would omit the column
     entirely. Falling back to "wallet" on a refusal keeps the old behaviour
     rather than inventing a reason. */
  const reported = String(row?.refused_by ?? "");
  const refusedBy: QuotaRefusal = reported === "global" ? "global" : "wallet";

  if (!allowed && refusedBy === "global") {
    /* An error rather than a warning, and it names the remedy. This is the one
       refusal in the module that is not about the user in front of it: every
       wallet on the deployment is being turned away until 00:00 UTC. */
    console.error(
      `[credits] the shared daily ceiling is spent: ${globalUsed}/${globalQuota} model requests. ` +
        "Every wallet is refused until 00:00 UTC. Raise AGENT_GLOBAL_DAILY_MODEL_REQUESTS, " +
        "or lower AGENT_DAILY_MODEL_REQUESTS if one identity took the bulk of it.",
    );
  } else if (
    allowed &&
    globalUsed === Math.ceil(globalQuota * GLOBAL_WARN_RATIO)
  ) {
    /* Fires once, and once only, without needing anywhere to remember that it
       already has: a successful consume moves the counter by exactly one, so it
       lands on this integer exactly once per day, in whichever instance happens
       to serve that request. */
    console.warn(
      `[credits] ${Math.round(GLOBAL_WARN_RATIO * 100)}% of the shared daily allowance is gone ` +
        `(${globalUsed}/${globalQuota}). At this rate it runs out before 00:00 UTC.`,
    );
  }

  return {
    allowed,
    used,
    quota,
    remaining: Math.max(0, quota - used),
    unmetered: false,
    ...(allowed ? {} : { refusedBy }),
    global: { used: globalUsed, quota: globalQuota },
  };
}

/**
 * Hands back a request that was spent but never served.
 *
 * `consumeModelRequest` runs immediately before dispatch, which is what keeps
 * locally-answered turns free — but it also means a request the provider
 * refuses outright has already been charged. The gateway screens some user
 * wording and answers 400 without reaching a model, so nothing was generated
 * and the day's allowance should not be one shorter for it.
 *
 * It hands back both counters, because a successful consume charged both. A
 * refund that returned only the wallet's would leave the shared counter
 * climbing by one on every gateway refusal and never coming down, until the
 * deployment sat at a ceiling nobody had actually reached.
 *
 * Only call this for a consume that was actually recorded: pass through
 * `decision.unmetered` and skip when it is true, or this decrements a counter
 * that was never incremented. Returns the corrected wallet state so the caller
 * can report an accurate remaining count, or null when there is nothing to
 * report.
 */
export async function releaseModelRequest(
  wallet: string | undefined,
  decision: Pick<QuotaDecision, "unmetered">,
): Promise<QuotaState | null> {
  if (!wallet || !supabaseAdmin || decision.unmetered) return null;

  const { data, error } = await supabaseAdmin.rpc("release_agent_request", {
    p_wallet: wallet,
    p_limit: DAILY_MODEL_REQUESTS,
  });

  if (error) {
    /* Logged, not thrown. The caller is already on its error path answering a
       refused request; failing to hand a credit back is worth knowing about but
       is not worth replacing that answer with a second failure. */
    console.error("[credits] release_agent_request failed:", error.message);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  const used = Number(row?.used ?? 0);
  const quota = Number(row?.quota ?? DAILY_MODEL_REQUESTS);
  return { used, quota, remaining: Math.max(0, quota - used) };
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
