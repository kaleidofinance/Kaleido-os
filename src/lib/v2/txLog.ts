import type { IntentKind } from "./intents";

/**
 * The transaction log — this device's record of what this app submitted.
 *
 * It is deliberately **not** a chain history. There is no indexer behind it and
 * no `eth_getLogs` sweep: it holds the transactions signed through
 * PlanReview in this browser, for this wallet, on this chain, and nothing else.
 * A swap made in another browser, from a hardware wallet's own UI, or before
 * this feature existed will not appear, and the modal that renders it says so in
 * as many words. That honesty is the whole reason it can be localStorage at all.
 *
 * It replaces the "Transactions" table that used to sit on /explore. That table
 * read `kaleido_protocol_activity`, which has had no writer since
 * `useSwapRouter.ts` lost its last consumer, rendered a raw token amount in a
 * column labelled USD, and published a wallet-to-amount map on a public page
 * against docs/points-system.md:259. A per-device log of your own signatures
 * answers the question that table was asked for — "what did I just do?" —
 * without any of those three problems, because the data never leaves the device.
 *
 * ## Why there is no "pending" status
 *
 * Every resolver in `intents/definitions.ts` calls `await tx.wait()` before
 * returning, so by the time `resolveIntent` resolves, the transaction has
 * already been mined — a hash and an unsettled outcome never coexist at this
 * layer, and a `pending` row would be a state the code cannot produce. The
 * in-flight view is PlanReview's own step spinner; this is the record of what
 * settled. If a resolver is ever changed to return before confirming, that is
 * the moment to add the third status, and not before.
 */

/** What became of it. See the note above on why "pending" is absent. */
export type TxStatus = "confirmed" | "reverted";

export interface TxLogEntry {
  hash: string;
  kind: IntentKind;
  /** The same line PlanReview showed on the step — `renderIntent`'s title. */
  title: string;
  detail?: string;
  status: TxStatus;
  /** ms since epoch, from the signing device's clock. */
  at: number;
}

/**
 * Bumped only on a breaking shape change. `readTxLog` validates every row it
 * parses, so a stale key is discarded row by row rather than crashing the
 * modal — the version exists to abandon an old key deliberately, not to make
 * parsing safe.
 */
const VERSION = 1;

/**
 * Entries kept per wallet, newest first. Fifty is roughly a screen and a half of
 * scrolling and a few KB of a 5 MB origin quota; the cap exists so a busy trader
 * cannot grow one key without bound, not to ration space.
 */
const MAX_ENTRIES = 50;

/**
 * Scoped to (chain, address), not to the wallet alone.
 *
 * Two reasons, and both are about not lying. A hash is only meaningful together
 * with the chain it was mined on, so a log spanning chains would need a chain
 * column on every row and an explorer link that could pick the wrong network.
 * And keying on the address means connecting a second wallet shows that wallet's
 * history rather than the previous one's — on a shared machine, the alternative
 * shows one person's activity to the next.
 */
export function txLogKey(chainId: number, address: string): string {
  return `kaleido.txlog.v${VERSION}.${chainId}.${address.toLowerCase()}`;
}

const HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * Shape check for one parsed row.
 *
 * localStorage is user-writable and survives a deploy, so a row can be anything:
 * hand-edited, written by an older build, or truncated by a quota error
 * mid-write. Every field is checked rather than cast, because the one thing this
 * module must never do is make the modal throw on open.
 */
function isEntry(v: unknown): v is TxLogEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.hash === "string" &&
    HASH.test(e.hash) &&
    typeof e.kind === "string" &&
    typeof e.title === "string" &&
    (e.detail === undefined || typeof e.detail === "string") &&
    (e.status === "confirmed" || e.status === "reverted") &&
    typeof e.at === "number" &&
    Number.isFinite(e.at)
  );
}

/* ------------------------------------------------------------- subscribers -- */

type Listener = (changedKey: string) => void;
const listeners = new Set<Listener>();

/**
 * Notified on every write from this tab.
 *
 * This is load-bearing and easy to get wrong: `localStorage.setItem` fires the
 * `storage` event in **other** tabs and never in the one that wrote, so a modal
 * relying on `storage` alone would sit stale while PlanReview filled the log
 * three components away. The repo has been bitten by the mirror image of this —
 * the deleted `notificationService.ts` dispatched a synthetic StorageEvent that
 * nothing listened for — so both halves are wired explicitly: this emitter for
 * same-tab writes, and a real `storage` listener in `useTxLog` for other tabs.
 */
export function subscribeTxLog(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(key: string): void {
  listeners.forEach((fn) => fn(key));
}

/* -------------------------------------------------------------------- read -- */

export function readTxLog(
  chainId: number | undefined,
  address: string | undefined,
): TxLogEntry[] {
  if (typeof window === "undefined" || !chainId || !address) return [];
  try {
    const raw = window.localStorage.getItem(txLogKey(chainId, address));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
  } catch {
    /* Unreadable storage is an empty log, never an error surfaced to the user:
       there is nothing they could do about it, and the trade they came to make
       does not depend on it. */
    return [];
  }
}

/* ------------------------------------------------------------------- write -- */

export function recordTx(
  chainId: number | undefined,
  address: string | undefined,
  entry: TxLogEntry,
): void {
  if (typeof window === "undefined" || !chainId || !address) return;
  if (!isEntry(entry)) return;

  const key = txLogKey(chainId, address);
  /* Keyed on the hash so re-recording the same transaction replaces its row
     instead of adding a second one — a retry that reuses a hash, or a status
     correction, updates in place. */
  const next = [
    entry,
    ...readTxLog(chainId, address).filter(
      (e) => e.hash.toLowerCase() !== entry.hash.toLowerCase(),
    ),
  ].slice(0, MAX_ENTRIES);

  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* Quota exceeded, or storage denied (Safari private browsing). The
       transaction itself already succeeded, so failing to write its receipt is
       not worth interrupting anyone over — and emitting here would tell the
       modal to re-read a value that did not change. */
    return;
  }
  emit(key);
}

export function clearTxLog(
  chainId: number | undefined,
  address: string | undefined,
): void {
  if (typeof window === "undefined" || !chainId || !address) return;
  const key = txLogKey(chainId, address);
  try {
    window.localStorage.removeItem(key);
  } catch {
    return;
  }
  emit(key);
}

/* ------------------------------------------------------- failures with a tx -- */

/**
 * The on-chain outcome behind a thrown step, when there is one.
 *
 * A failed step is one of several very different things and only some of them
 * belong in a log, so this reads the outcome off the receipt rather than assuming
 * "threw" means "reverted". Verified against the two places ethers 6 throws from
 * `tx.wait()` (node_modules/ethers/lib.commonjs/providers/provider.js):
 *
 * - **No hash at all** — a rejected signature or a failed gas estimate. Nothing
 *   reached the chain, nothing was paid, and a row for it would be a record of a
 *   decision not to trade. Returns null.
 * - **`CALL_EXCEPTION`** (:1127) — thrown when `receipt.status === 0`, with that
 *   receipt attached. This is the reverted case: it cost gas and is exactly what
 *   someone opens the modal to find.
 * - **`TRANSACTION_REPLACED`** (:1110) — thrown when the wallet replaced the
 *   transaction, and the attached receipt is the **replacement's**, which very
 *   often has `status === 1`. Reading the throw as a revert here would tell a
 *   user who hit "speed up" that their swap failed when it landed, so the status
 *   comes from the receipt and never from the fact that something threw.
 *   `cancelled` is ethers' own flag for "the original's effects cannot be
 *   assured" (errors.d.ts:387-390) — true for a cancel, false for a reprice —
 *   and a cancelled step returns null, because the transaction that did land is
 *   a zero-value self-send and filing it under "Swap ETH for USDC" would be
 *   worse than filing nothing.
 *
 * Duck-typed rather than importing ethers' error classes, which keeps this
 * module dependency-free; the hash pattern rejects anything that merely happens
 * to carry a `hash` property.
 */
export function txFromError(
  err: unknown,
): { hash: string; status: TxStatus } | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as {
    cancelled?: unknown;
    receipt?: { hash?: unknown; status?: unknown };
  };

  if (e.cancelled === true) return null;

  const hash = e.receipt?.hash;
  const status = e.receipt?.status;
  if (typeof hash !== "string" || !HASH.test(hash)) return null;
  /* No receipt status is an unknown outcome, and this store has no way to say
     "unknown" — better no row than a guessed one. */
  if (status !== 0 && status !== 1) return null;

  return { hash, status: status === 0 ? "reverted" : "confirmed" };
}
