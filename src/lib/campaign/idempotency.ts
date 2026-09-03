/**
 * The idempotency key `scripts/send_campaign.mts` sends with each batch.
 *
 * ── Why this is not just `${chunk[0]}-${chunk.length}` ──────────────────────
 *
 * It was, and that broke a real send. Resend holds an idempotency key for 24
 * hours and answers a *reused key with a modified body* with a hard error:
 *
 *   "This idempotency key has been used with this HTTP method and endpoint
 *    within the last 24 hours, but the request body was modified and doesn't
 *    match the original request."
 *
 * A key derived from the addresses alone cannot tell the difference between the
 * two cases, and they want opposite outcomes:
 *
 *   RETRY of a request that may already have landed — same addresses, same
 *   message. The response was lost to a timeout, so nothing local knows whether
 *   the provider accepted it. The key must be THE SAME, so the provider dedupes.
 *
 *   RESUBMIT after the copy was edited — same addresses, different message. A
 *   link was wrong, or the access code changed. The key must be DIFFERENT, or
 *   the whole chunk is rejected.
 *
 * The second case is the likely one on a four-day campaign: send a batch, notice
 * something in the copy, fix it, run again. With an address-only key that run
 * failed for all 100 addresses in the chunk at once, recorded nothing per
 * address, and tripped the 5% abort — while the message the operator was
 * looking at was fine.
 *
 * So the key is derived from BOTH halves of what makes the request: who it goes
 * to, and what it says. Identical in both, and it is a retry. Different in
 * either, and it is a new request.
 *
 * Two properties worth keeping deliberately:
 *
 * FIXED LENGTH. Resend caps the key at 256 characters and an email address may
 * itself be 254, so a key with an address in it can exceed the cap on one long
 * address in the wrong position. Hashes make the length constant.
 *
 * NO SECRET IN CLEARTEXT. The access code is part of the message body, and this
 * value travels in an HTTP header that ends up in provider logs. Hashing the
 * body means the key commits to the code without carrying it.
 */

import { createHash } from "node:crypto";

/**
 * Every part of the message a recipient could notice. Anything that changes
 * what lands in an inbox belongs here; anything else must not, or a cosmetic
 * edit invalidates a legitimate retry.
 */
export type MessageParts = {
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
};

/* Length-prefixed rather than joined by a separator, because every printable
   separator can also occur inside an email body. Joining on one lets an edit
   move a boundary without changing the digest — subject "ab" + text "c" would
   hash identically to subject "a" + text "bc", so a copy change could go unnoticed
   here and the chunk be rejected by the provider instead. Prefixing each field
   with its own length has no such ambiguity, and needs no character that cannot
   be typed into a source file. */
function digest(fields: readonly string[]): string {
  const h = createHash("sha256");
  for (const f of fields) h.update(`${f.length}:${f}`);
  /* 12 hex characters is 48 bits. The population is one campaign's chunks over a
     24-hour window — tens of values — so collision risk is nil, and short keys
     stay readable in a provider log. */
  return h.digest("hex").slice(0, 12);
}

/** Identifies the message. Changes whenever anything a recipient sees changes. */
export function messageFingerprint(m: MessageParts): string {
  return digest([m.from, m.replyTo, m.subject, m.text, m.html]);
}

/**
 * Identifies the batch. Order-sensitive on purpose: the request body is an
 * array, so a reordered chunk really is a different body, and the provider
 * would reject it under a shared key. Nothing is lost by treating it as new —
 * the state file, not this key, is what stops an address being mailed twice.
 */
export function recipientsFingerprint(chunk: readonly string[]): string {
  return digest(chunk);
}

/**
 * The header value. Prefixed so it is identifiable among whatever else the
 * account sends.
 */
export function idempotencyKey(m: MessageParts, chunk: readonly string[]): string {
  return `kaleido-invite-${messageFingerprint(m)}-${recipientsFingerprint(chunk)}`;
}

/** Resend's documented ceiling, asserted by the test rather than assumed. */
export const KEY_MAX_LENGTH = 256;
