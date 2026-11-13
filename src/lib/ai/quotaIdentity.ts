import { verifyWalletSignature } from "@/lib/auth/verifyWalletSignature";

const MAX_AGE_MS = 10 * 60_000;

export interface QuotaIdentityInput {
  address?: unknown;
  signature?: unknown;
  signedAt?: unknown;
}

/**
 * Optional signed-session binding for model quota. Existing clients can keep
 * sending an address while they migrate; once a signature is present it must
 * prove the same address and be fresh, so a caller cannot meter another wallet.
 */
export async function resolveQuotaIdentity(input: QuotaIdentityInput): Promise<{
  address?: string;
  authenticated: boolean;
  error?: string;
}> {
  const address = typeof input.address === "string" ? input.address.toLowerCase() : undefined;
  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) return { authenticated: false };
  const signature = typeof input.signature === "string" ? input.signature : "";
  if (!signature) return { address, authenticated: false };
  const signedAt = Number(input.signedAt);
  if (!Number.isFinite(signedAt) || Math.abs(Date.now() - signedAt) > MAX_AGE_MS) {
    return { authenticated: false, error: "The quota signature expired. Please sign again." };
  }
  const message = `Kaleido Luca quota session:${address}:${signedAt}`;
  const valid = await verifyWalletSignature(address, message, signature);
  return valid
    ? { address, authenticated: true }
    : { authenticated: false, error: "The quota signature does not match this wallet." };
}
