import { verifyMessage } from "ethers";

/**
 * Admin gate for the /analytics/admin section.
 *
 * The app has no password auth — identity is a wallet — so an admin proves
 * access the same way every other sensitive action is proven: by signing a
 * message with a wallet on an env allowlist. The signature is checked
 * server-side (never the client's word for who it is), the message carries a
 * timestamp so a captured signature cannot be replayed forever, and the address
 * must be in ADMIN_WALLETS.
 */

export const ADMIN_MESSAGE_PREFIX = "Kaleido analytics admin";

/** Proof is valid for this long after it was signed, so a session refreshes
 *  without re-signing every minute, but a leaked signature still expires. */
export const ADMIN_PROOF_TTL_MS = 30 * 60 * 1000;

/** The wallets allowed into the admin section, lowercased. */
export function adminWallets(): Set<string> {
  return new Set(
    (process.env.ADMIN_WALLETS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^0x[0-9a-f]{40}$/.test(s)),
  );
}

export function isAdminWallet(address: string): boolean {
  return adminWallets().has((address ?? "").toLowerCase());
}

/** The exact message the client signs, reconstructed server-side from `ts`. */
export function adminMessage(ts: number): string {
  return `${ADMIN_MESSAGE_PREFIX}\n${new Date(ts).toISOString()}`;
}

export type AdminVerdict =
  | { ok: true; address: string }
  | { ok: false; error: string; status: number };

/**
 * Verify an admin proof. Pure but for `Date.now()` (which `now` overrides for
 * tests): the timestamp must be recent, the signature must recover to `address`,
 * and `address` must be on the allowlist. Order matters only for the message it
 * returns — every branch fails closed.
 */
export function verifyAdmin(
  input: { address?: unknown; signature?: unknown; ts?: unknown },
  now = Date.now(),
): AdminVerdict {
  const address = String(input.address ?? "").toLowerCase();
  const signature = String(input.signature ?? "");
  const ts = Number(input.ts);

  if (!/^0x[0-9a-f]{40}$/.test(address))
    return { ok: false, error: "address", status: 400 };
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature))
    return { ok: false, error: "signature", status: 400 };
  if (!Number.isFinite(ts) || Math.abs(now - ts) > ADMIN_PROOF_TTL_MS)
    return { ok: false, error: "proof expired — re-verify", status: 401 };

  let recovered: string;
  try {
    recovered = verifyMessage(adminMessage(ts), signature).toLowerCase();
  } catch {
    return { ok: false, error: "bad signature", status: 401 };
  }
  if (recovered !== address)
    return { ok: false, error: "signature does not match", status: 401 };
  if (!isAdminWallet(address))
    return { ok: false, error: "not an admin wallet", status: 403 };

  return { ok: true, address };
}
