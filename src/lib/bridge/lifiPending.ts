export type LifiPending = {
  txHash: string;
  sourceChainId: number;
  destinationChainId: number;
  destinationChainName: string;
  amount: string;
  symbol: string;
  createdAt: number;
};

const HASH = /^0x[0-9a-fA-F]{64}$/;
const key = (address: string) => `kaleido.lifi.pending.${address.toLowerCase()}`;

export function readLifiPending(address?: string): LifiPending[] {
  if (typeof window === "undefined" || !address) return [];
  try {
    const raw = window.localStorage.getItem(key(address));
    const rows = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(rows)) return [];
    return rows.filter((row): row is LifiPending =>
      row && typeof row === "object" && HASH.test(row.txHash) &&
      Number.isInteger(row.sourceChainId) && Number.isInteger(row.destinationChainId) &&
      typeof row.destinationChainName === "string" && typeof row.amount === "string" &&
      typeof row.symbol === "string" && typeof row.createdAt === "number",
    );
  } catch {
    return [];
  }
}

export function recordLifiPending(address: string | undefined, row: LifiPending): void {
  if (typeof window === "undefined" || !address || !HASH.test(row.txHash)) return;
  const next = [row, ...readLifiPending(address).filter((r) => r.txHash.toLowerCase() !== row.txHash.toLowerCase())].slice(0, 50);
  try { window.localStorage.setItem(key(address), JSON.stringify(next)); } catch { /* best effort */ }
}

export function removeLifiPending(address: string | undefined, txHash: string): void {
  if (typeof window === "undefined" || !address) return;
  try { window.localStorage.setItem(key(address), JSON.stringify(readLifiPending(address).filter((r) => r.txHash.toLowerCase() !== txHash.toLowerCase()))); } catch { /* best effort */ }
}
