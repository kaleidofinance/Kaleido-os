/**
 * Device-local memory for a Synthra external execution that has been signed.
 *
 * The source transaction is final before Synthra's destination leg is. Keep
 * the provider request id beside the source hash so Luca can ask the server
 * for the durable status later without exposing the Synthra API key.
 */
export interface SynthraPending {
  txHash: string;
  requestId: string;
  sourceChainId: number;
  destinationChainId: number;
  destinationChainName: string;
  amount: string;
  symbol: string;
  createdAt: number;
}

const HASH = /^0x[0-9a-fA-F]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,256}$/;
const MAX_ENTRIES = 50;
const key = (address: string) =>
  `kaleido.synthra.pending.${address.toLowerCase()}`;

function isPending(value: unknown): value is SynthraPending {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.txHash === "string" &&
    HASH.test(row.txHash) &&
    typeof row.requestId === "string" &&
    REQUEST_ID.test(row.requestId) &&
    Number.isInteger(row.sourceChainId) &&
    Number.isInteger(row.destinationChainId) &&
    typeof row.destinationChainName === "string" &&
    typeof row.amount === "string" &&
    typeof row.symbol === "string" &&
    typeof row.createdAt === "number" &&
    Number.isFinite(row.createdAt)
  );
}

export function readSynthraPending(address?: string): SynthraPending[] {
  if (typeof window === "undefined" || !address) return [];
  try {
    const raw = window.localStorage.getItem(key(address));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isPending) : [];
  } catch {
    return [];
  }
}

export function recordSynthraPending(
  address: string | undefined,
  row: SynthraPending,
): void {
  if (typeof window === "undefined" || !address || !isPending(row)) return;
  const next = [
    row,
    ...readSynthraPending(address).filter(
      (entry) => entry.requestId !== row.requestId,
    ),
  ].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(key(address), JSON.stringify(next));
  } catch {
    /* The source transaction already landed; local persistence is best effort. */
  }
}

export function removeSynthraPending(
  address: string | undefined,
  requestId: string,
): void {
  if (typeof window === "undefined" || !address || !REQUEST_ID.test(requestId))
    return;
  try {
    window.localStorage.setItem(
      key(address),
      JSON.stringify(
        readSynthraPending(address).filter(
          (entry) => entry.requestId !== requestId,
        ),
      ),
    );
  } catch {
    /* Best effort only. */
  }
}
