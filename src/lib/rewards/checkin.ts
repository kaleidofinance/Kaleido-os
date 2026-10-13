/**
 * Daily check-in: +25 $kPoint once per UTC day per wallet, plus a +100 bonus
 * on every 7th consecutive day (day 7, 14, 21, …).
 *
 * The once-a-day rule is enforced by the database, not by this code: the
 * credit is a `point_actions` row whose tx_hash is `checkin:<wallet>:<day>`,
 * and (chain_id, tx_hash) is unique — so a double click, two tabs or a
 * replayed request all land on the same row and credit once.
 */
export const CHECKIN_POINTS = 25;
export const STREAK_LENGTH = 7;
export const STREAK_BONUS = 100;
/** One-time bonus for the first WELCOME_LIMIT wallets ever to check in. */
export const WELCOME_BONUS = 500;
export const WELCOME_LIMIT = 100;
export const WELCOME_PREFIX = "checkin-welcome:";
export const CHECKIN_SOURCE = "checkin";
export const CHECKIN_CHAIN_ID = 5042;

/** The UTC calendar day, YYYY-MM-DD. */
export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** What the wallet signs. Names the day, so a signature is only good for it. */
export function checkinMessage(address: string, day: string): string {
  return `Kaleido daily check-in for wallet ${address.toLowerCase()} on ${day}.`;
}

export function checkinTxHash(address: string, day: string): string {
  return `checkin:${address.toLowerCase()}:${day}`;
}

/** The streak bonus row for a day — its own unique key, so it pays once. */
export function streakBonusTxHash(address: string, day: string): string {
  return `checkin-streak:${address.toLowerCase()}:${day}`;
}

/** The day a daily check-in row is for, or null for any other row (a bonus). */
export function dayOfCheckinHash(txHash: string): string | null {
  const m = /^checkin:0x[0-9a-f]{40}:(\d{4}-\d{2}-\d{2})$/i.exec(txHash);
  return m ? m[1] : null;
}

const prevDay = (day: string): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Consecutive check-in days ending on `day` (counting `day` itself if present;
 * 0 if `day` isn't checked in). Pure.
 */
export function streakEndingOn(days: Iterable<string>, day: string): number {
  const set = new Set(days);
  let n = 0;
  for (let d = day; set.has(d); d = prevDay(d)) n++;
  return n;
}

/**
 * The current streak for display: ending today if checked in today, else
 * ending yesterday (still alive until tonight's UTC midnight).
 */
export function currentStreak(days: Iterable<string>, today: string): number {
  const list = [...days];
  return streakEndingOn(list, today) || streakEndingOn(list, prevDay(today));
}

/** Does checking in on a day that completes a streak of `n` earn the bonus? */
export function earnsStreakBonus(n: number): boolean {
  return n > 0 && n % STREAK_LENGTH === 0;
}

/** Milliseconds until the next UTC midnight, for "next check-in in …". */
export function msUntilNextUtcDay(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}
