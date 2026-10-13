import { isCctpDomainChain } from "./cctp";

/**
 * This device's record of CCTP burns that have not been completed yet.
 *
 * A CCTP transfer is two transactions on two chains minutes apart (see cctp.ts):
 * the source burn, then — once Circle attests — the destination mint. Between
 * them the USDC is burned but not yet minted, and nothing on either chain says
 * "this person has a transfer waiting to be finished". This store is that memory:
 * PlanReview writes a row when a `provider:"cctp"` bridge confirms, the manual
 * completion surface and Luca read it to offer "Complete on {dest}", and the row
 * is removed once the mint lands.
 *
 * Like txLog it is deliberately localStorage and nothing more — per device, per
 * wallet, no server. That is a real limitation (a burn from another device or
 * browser will not appear here) and an honest one: the alternative is a backend
 * that tracks users' in-flight funds, and the recovery path for a row this store
 * never saw is Circle's own hosted app at bridge.usdc.com, which reconstructs it
 * from the chain. The store is a convenience over that, not a system of record.
 *
 * Keyed by WALLET ONLY, not by chain: a pending transfer spans two chains and
 * the row must be readable from the destination chain where it is completed, not
 * only the source chain where it was burned. The address is the same on both for
 * an EOA and a same-address smart wallet, which is the mint recipient the burn
 * named.
 */
export interface PendingCctp {
  /** The source-chain burn transaction — the key Circle's attestation is read by. */
  txHash: string;
  sourceChainId: number;
  destChainId: number;
  /** Destination display name, for the row without a chain lookup. */
  destChainName: string;
  /** Human amount burned, for the row. */
  amount: string;
  symbol: string;
  /** When the burn confirmed (unix ms), for ordering and a "waiting" hint. */
  burnedAt: number;
  /**
   * Set when the user manually closes the completion bar for this transfer.
   * The row is KEPT (the transfer may still be unfinished, and losing it would
   * lose the way to complete it) but hidden from the bar. The on-chain
   * self-clear still removes it entirely once it mints.
   */
  dismissedAt?: number;
}

const MAX_ENTRIES = 50;

/** One list per wallet, across all corridors. Lower-cased so the key is stable. */
export function cctpPendingKey(address: string): string {
  return `kaleido.cctp.pending.${address.toLowerCase()}`;
}

/**
 * localStorage is user-writable and survives deploys, so a stored row can be
 * anything. Validate every field before trusting it — a corrupt entry is
 * dropped, never rendered or signed against.
 */
function isPending(v: unknown): v is PendingCctp {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.txHash === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(e.txHash) &&
    typeof e.sourceChainId === "number" &&
    typeof e.destChainId === "number" &&
    isCctpDomainChain(e.sourceChainId) &&
    isCctpDomainChain(e.destChainId) &&
    typeof e.destChainName === "string" &&
    typeof e.amount === "string" &&
    typeof e.symbol === "string" &&
    typeof e.burnedAt === "number" &&
    (e.dismissedAt === undefined || typeof e.dismissedAt === "number")
  );
}

/* ------------------------------------------------------------- subscribe -- */

type Listener = (changedKey: string) => void;
const listeners = new Set<Listener>();

/**
 * Same-tab writes. `localStorage.setItem` fires the `storage` event in OTHER
 * tabs and never the writing one, so a completion surface relying on `storage`
 * alone would sit stale while PlanReview recorded a burn beside it — the exact
 * trap txLog documents. This emitter covers same-tab; the hook adds a real
 * `storage` listener for other tabs.
 */
export function subscribeCctpPending(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(key: string): void {
  listeners.forEach((fn) => fn(key));
}

/* ------------------------------------------------------------------ read -- */

export function readCctpPending(address: string | undefined): PendingCctp[] {
  if (typeof window === "undefined" || !address) return [];
  try {
    const raw = window.localStorage.getItem(cctpPendingKey(address));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPending);
  } catch {
    // Unreadable storage is an empty list, never an error — the same posture as
    // txLog: there is nothing the user could do, and no trade depends on it.
    return [];
  }
}

/* ----------------------------------------------------------------- write -- */

export function recordCctpBurn(
  address: string | undefined,
  entry: PendingCctp,
): void {
  if (typeof window === "undefined" || !address) return;
  if (!isPending(entry)) return;

  const key = cctpPendingKey(address);
  // Keyed on the burn hash so a re-record replaces rather than duplicates.
  const next = [
    entry,
    ...readCctpPending(address).filter(
      (e) => e.txHash.toLowerCase() !== entry.txHash.toLowerCase(),
    ),
  ].slice(0, MAX_ENTRIES);

  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Quota exceeded or storage denied (private browsing). The burn already
    // landed; failing to note it is not worth interrupting anyone, and Circle
    // can still complete it from bridge.usdc.com.
    return;
  }
  emit(key);


  /* Tell the server too. The completion keeper (lib/keeper/cctpKeeper.ts)
     reads that registry, not this browser, and it is what mints on the
     destination for a wallet that has no gas there. Fire-and-forget with
     keepalive, so a navigation does not cancel it and a failure cannot become
     a visible one — the banner still works off localStorage regardless, and
     the route verifies the burn on chain before it writes. */
  void fetch("/api/cctp/record", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...entry, recipient: address }),
  }).catch(() => {});
}

/**
 * Mark a transfer dismissed: keep the row, hide it from the bar. Idempotent;
 * a no-op for an address or hash that isn't there.
 */
export function dismissCctpPending(
  address: string | undefined,
  txHash: string,
): void {
  if (typeof window === "undefined" || !address) return;
  const key = cctpPendingKey(address);
  const rows = readCctpPending(address);
  let changed = false;
  const next = rows.map((r) => {
    if (r.txHash.toLowerCase() === txHash.toLowerCase() && !r.dismissedAt) {
      changed = true;
      return { ...r, dismissedAt: Date.now() };
    }
    return r;
  });
  if (!changed) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    return;
  }
  emit(key);
}

export function removeCctpPending(
  address: string | undefined,
  txHash: string,
): void {
  if (typeof window === "undefined" || !address) return;
  const key = cctpPendingKey(address);
  const next = readCctpPending(address).filter(
    (e) => e.txHash.toLowerCase() !== txHash.toLowerCase(),
  );
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    return;
  }
  emit(key);
}
