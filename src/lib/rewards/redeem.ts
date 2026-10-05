/** Redeem codes: shared by the Rewards page and POST /api/rewards/redeem. */

/** Codes are stored upper-case; users may type them any case, with spaces. */
export function normalizeCode(raw: string): string {
  const c = raw.toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9-]{6,40}$/.test(c) ? c : "";
}

/** What the wallet signs to redeem. Names the code so a signature can't be reused for another. */
export function redeemMessage(address: string, code: string): string {
  return `Redeem Kaleido code ${normalizeCode(code)} for wallet ${address.toLowerCase()}.`;
}

/** A fresh unguessable code: PREFIX-XXXX-XXXX-XXXX (no 0/O/1/I). */
export function makeCode(prefix = "KLD", rand: () => number = Math.random): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const group = () => Array.from({ length: 4 }, () => A[Math.floor(rand() * A.length)]).join("");
  return `${prefix.toUpperCase()}-${group()}-${group()}-${group()}`;
}
