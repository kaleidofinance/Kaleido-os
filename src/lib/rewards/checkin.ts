/**
 * Daily check-in: +10 $kPoint once per UTC day per wallet.
 *
 * The once-a-day rule is enforced by the database, not by this code: the
 * credit is a `point_actions` row whose tx_hash is `checkin:<wallet>:<day>`,
 * and (chain_id, tx_hash) is unique — so a double click, two tabs or a
 * replayed request all land on the same row and credit once.
 */
export const CHECKIN_POINTS = 10;
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

/** Milliseconds until the next UTC midnight, for "next check-in in …". */
export function msUntilNextUtcDay(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}
