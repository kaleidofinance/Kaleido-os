/**
 * Point accrual arithmetic.
 *
 * Deliberately pure: it takes balance observations and rate config in, and
 * returns epochs out. It reads no chain, opens no socket and touches no
 * database, so it can be tested exhaustively without a deployment — which
 * matters because the protocol's contracts are being rewritten and this logic
 * must outlive them.
 *
 * Fetching balances is the contract-dependent half and lives elsewhere.
 */

/** One balance observation for a wallet on a chain from a single source. */
export interface Snapshot {
  wallet: string;
  chainId: number;
  sourceSlug: string;
  /** USD value at observation. Null when the asset has no market price. */
  usdValue: number | null;
  /** Raw token units, carried for assets with no USD price (KLD pre-TGE). */
  rawAmount?: number | null;
  rawSymbol?: string | null;
  blockNumber: number;
  takenAt: Date;
}

/** Rate config for one source in one season, mirroring point_source_rates. */
export interface SourceRate {
  /** Time sources: points per USD per day. Action sources: points per USD. */
  rate: number;
  multiplier: number;
  minUsd: number;
  dailyCapPts: number | null;
  multiplierActionLimit: number | null;
}

export interface Epoch {
  wallet: string;
  chainId: number;
  sourceSlug: string;
  season: number;
  epochStart: Date;
  epochEnd: Date;
  usdSeconds: number;
  points: number;
}

const SECONDS_PER_DAY = 86_400;

/**
 * Accrue one interval between two consecutive snapshots.
 *
 * Uses **min(previous, current)** rather than either endpoint or an average.
 * That is the whole anti-gaming story for time-weighted points: a wallet that
 * deposits heavily just before a snapshot and withdraws just after is credited
 * only for what it demonstrably held across the entire interval. Using the
 * opening value would pay for capital already withdrawn; using the closing
 * value would pay for capital that arrived seconds ago; an average would pay
 * half of both.
 *
 * Returns null when nothing accrued, so callers can skip the insert entirely
 * rather than storing zero rows.
 */
export function accrueInterval(
  previous: Snapshot,
  current: Snapshot,
  rateConfig: SourceRate,
  season: number,
  chainMultiplier = 1,
): Epoch | null {
  if (
    previous.wallet !== current.wallet ||
    previous.chainId !== current.chainId ||
    previous.sourceSlug !== current.sourceSlug
  ) {
    throw new Error("accrueInterval: snapshots describe different series");
  }

  const elapsed =
    (current.takenAt.getTime() - previous.takenAt.getTime()) / 1000;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return null;

  // An asset with no USD price still accrues, denominated in its own units —
  // otherwise staking a pre-TGE token would silently earn nothing.
  const priced = previous.usdValue !== null && current.usdValue !== null;
  const held = priced
    ? Math.min(previous.usdValue as number, current.usdValue as number)
    : Math.min(previous.rawAmount ?? 0, current.rawAmount ?? 0);

  if (!(held > 0)) return null;
  // minUsd is a floor on the position, not on the interval: dust positions
  // should not accrue merely by existing for a long time.
  if (priced && held < rateConfig.minUsd) return null;

  const usdSeconds = held * elapsed;
  const points =
    (usdSeconds / SECONDS_PER_DAY) *
    rateConfig.rate *
    rateConfig.multiplier *
    chainMultiplier;

  if (!(points > 0)) return null;

  return {
    wallet: current.wallet,
    chainId: current.chainId,
    sourceSlug: current.sourceSlug,
    season,
    epochStart: previous.takenAt,
    epochEnd: current.takenAt,
    usdSeconds,
    points,
  };
}

/**
 * Accrue a whole ordered series of snapshots for one wallet/chain/source.
 * Snapshots are sorted defensively — an out-of-order series would otherwise
 * produce negative intervals that silently vanish.
 */
export function accrueSeries(
  snapshots: Snapshot[],
  rateConfig: SourceRate,
  season: number,
  chainMultiplier = 1,
): Epoch[] {
  if (snapshots.length < 2) return [];
  const ordered = [...snapshots].sort(
    (a, b) => a.takenAt.getTime() - b.takenAt.getTime(),
  );

  const out: Epoch[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const epoch = accrueInterval(
      ordered[i - 1],
      ordered[i],
      rateConfig,
      season,
      chainMultiplier,
    );
    if (epoch) out.push(epoch);
  }
  return out;
}

/**
 * Apply a per-wallet-per-day point ceiling across already-computed epochs.
 *
 * Applied after accrual rather than inside it because the cap spans sources
 * and intervals: a wallet splitting one position across ten snapshots must not
 * earn ten times the daily allowance. Epochs are trimmed in chronological
 * order, so the earliest activity in a day is what survives the ceiling.
 */
export function applyDailyCap(
  epochs: Epoch[],
  dailyCapPts: number | null,
): Epoch[] {
  if (dailyCapPts === null || !(dailyCapPts > 0)) return epochs;

  const dayKey = (e: Epoch) =>
    `${e.wallet}|${e.epochEnd.toISOString().slice(0, 10)}`;

  const spent = new Map<string, number>();
  const ordered = [...epochs].sort(
    (a, b) => a.epochEnd.getTime() - b.epochEnd.getTime(),
  );

  const out: Epoch[] = [];
  for (const e of ordered) {
    const k = dayKey(e);
    const used = spent.get(k) ?? 0;
    if (used >= dailyCapPts) continue;

    const allowed = Math.min(e.points, dailyCapPts - used);
    spent.set(k, used + allowed);
    out.push(allowed === e.points ? e : { ...e, points: allowed });
  }
  return out;
}

/**
 * Points for one verified action.
 *
 * `priorActionsToday` drives the multiplier decay that keeps an agent from
 * being the cheapest farming tool on the platform: beyond the configured
 * limit the bonus falls away and an agent-built transaction is worth exactly
 * what the same transaction would have been worth by hand.
 */
export function actionPoints(
  usdValue: number,
  rateConfig: SourceRate,
  priorActionsToday = 0,
): { points: number; multiplierApplied: number } {
  if (!Number.isFinite(usdValue) || usdValue < rateConfig.minUsd) {
    return { points: 0, multiplierApplied: 0 };
  }

  const decayed =
    rateConfig.multiplierActionLimit !== null &&
    priorActionsToday >= rateConfig.multiplierActionLimit;

  const multiplierApplied = decayed ? 1 : rateConfig.multiplier;
  return {
    points: usdValue * rateConfig.rate * multiplierApplied,
    multiplierApplied,
  };
}
