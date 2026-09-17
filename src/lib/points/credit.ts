import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { actionPoints, type SourceRate } from "./accrual";

/**
 * The one trusted writer of action points.
 *
 * Every collector — the swap-fee indexer, and whatever comes after it — funnels
 * through `creditAction`, so the rules that matter (the season's configured rate,
 * the `minUsd` dust floor, the daily cap, the agent-spam multiplier decay, and
 * idempotency) live in exactly one place and cannot drift between sources. It
 * mirrors the shape the waitlist activation already writes into `point_actions`,
 * with the one difference that its `tx_hash` is a REAL on-chain hash — which is
 * what makes re-running a collector safe: the unique constraint turns a second
 * credit for the same transaction into a no-op (23505).
 *
 * Nothing here trusts its caller about *how much*: `usdValue` is the value the
 * collector derived from the chain, and the points are `usdValue × rate ×
 * multiplier` capped by the day — a collector that lied about the value would
 * still be bounded by the same cap every honest one is.
 */

export interface CreditInput {
  wallet: string;
  /** A `point_sources.slug`, e.g. "swap". */
  source: string;
  season: number;
  chainId: number;
  /** The on-chain transaction that earned it — the idempotency key. */
  txHash: string;
  /** USD value of the action, derived on-chain by the collector. */
  usdValue: number;
  /** When it happened, ISO. Defaults to now. */
  occurredAt?: string;
  isAgentInitiated?: boolean;
}

export type CreditResult =
  | { status: "credited"; points: number }
  | { status: "skipped"; reason: string };

/**
 * The pure half: given the season's rate, how many actions and points the wallet
 * already has today, and this action's value, how many points does it earn?
 *
 * Composes `actionPoints` (the `minUsd` gate + the multiplier decay past the
 * daily action limit) with the daily POINTS cap, which `actionPoints` does not
 * apply. Exported and tested on its own because this is the arithmetic a mistake
 * would leak tokens through — the DB wrapper below is thin glue.
 */
export function computeActionCredit(
  usdValue: number,
  rate: SourceRate,
  priorActionsToday: number,
  usedPointsToday: number,
): { points: number; multiplierApplied: number } {
  const { points, multiplierApplied } = actionPoints(
    usdValue,
    rate,
    priorActionsToday,
  );
  if (points <= 0) return { points: 0, multiplierApplied: 0 };
  if (rate.dailyCapPts === null) return { points, multiplierApplied };
  const room = rate.dailyCapPts - usedPointsToday;
  if (room <= 0) return { points: 0, multiplierApplied };
  return { points: Math.min(points, room), multiplierApplied };
}

/** UTC start-of-day for a timestamp, so the daily cap resets on the UTC boundary
 *  the rest of the points system uses (seasons, campaign batches). */
function startOfUtcDay(at: Date): string {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  ).toISOString();
}

async function loadRate(
  source: string,
  season: number,
): Promise<SourceRate | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("point_source_rates")
    .select("rate, multiplier, min_usd, daily_cap_pts, multiplier_action_limit")
    .eq("source_slug", source)
    .eq("season", season)
    .maybeSingle();
  if (error || !data) return null;
  return {
    rate: Number(data.rate),
    multiplier: Number(data.multiplier),
    minUsd: Number(data.min_usd ?? 0),
    dailyCapPts: data.daily_cap_pts === null ? null : Number(data.daily_cap_pts),
    multiplierActionLimit:
      data.multiplier_action_limit === null
        ? null
        : Number(data.multiplier_action_limit),
  };
}

/** This wallet's action count and points sum today, for (source, season). */
async function todaySoFar(
  wallet: string,
  source: string,
  season: number,
  since: string,
): Promise<{ count: number; points: number }> {
  if (!supabaseAdmin) return { count: 0, points: 0 };
  const { data, error } = await supabaseAdmin
    .from("point_actions")
    .select("points")
    .eq("wallet", wallet)
    .eq("source_slug", source)
    .eq("season", season)
    .gte("occurred_at", since);
  if (error || !data) return { count: 0, points: 0 };
  return {
    count: data.length,
    points: data.reduce((s, r) => s + Number(r.points ?? 0), 0),
  };
}

/**
 * Credit one on-chain action. Idempotent on `txHash`, fail-soft on everything
 * (a missing rate, a closed client, a duplicate) — a collector calling this in a
 * loop must never have one bad row abort the batch.
 */
export async function creditAction(input: CreditInput): Promise<CreditResult> {
  if (!supabaseAdmin) return { status: "skipped", reason: "no admin client" };

  const wallet = input.wallet.toLowerCase();
  const rate = await loadRate(input.source, input.season);
  if (!rate) return { status: "skipped", reason: "no rate for source/season" };

  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const since = startOfUtcDay(new Date(occurredAt));
  const { count, points: usedToday } = await todaySoFar(
    wallet,
    input.source,
    input.season,
    since,
  );

  const { points, multiplierApplied } = computeActionCredit(
    input.usdValue,
    rate,
    count,
    usedToday,
  );
  if (points <= 0) return { status: "skipped", reason: "below min or capped" };

  const { error } = await supabaseAdmin.from("point_actions").insert({
    wallet,
    source_slug: input.source,
    season: input.season,
    tx_hash: input.txHash,
    chain_id: input.chainId,
    usd_value: input.usdValue,
    multiplier_applied: multiplierApplied,
    points,
    is_agent_initiated: !!input.isAgentInitiated,
    occurred_at: occurredAt,
  });
  if (error) {
    // 23505 = already credited by an earlier run. Safe, expected, not an error.
    return {
      status: "skipped",
      reason: error.code === "23505" ? "already credited" : `insert:${error.code}`,
    };
  }
  return { status: "credited", points };
}
