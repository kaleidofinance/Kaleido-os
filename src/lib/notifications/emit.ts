"use client";

/**
 * How app code raises a notification.
 *
 * This replaces `src/utils/notificationService.ts`, which was the v1 pipeline and
 * could not deliver anything by any path:
 *
 *  1. It POSTed every notification to `NEXT_PUBLIC_API_BASE ||
 *     "http://127.0.0.1:8000"`. That variable appears in no env file, so the
 *     hardcoded localhost was the live value — in production too. On failure it
 *     fell back to POSTing a natural-language *instruction* ("Send warning
 *     notification to user 0x… ") to `/agent/chat` on the same dead host, with an
 *     admin wallet hardcoded in the body.
 *  2. Its only working half wrote a row into `localStorage.kaleido_notifications`
 *     and dispatched a synthetic StorageEvent. Nothing listens for that event,
 *     and that key is owned by NotificationsContext, which rewrites it wholesale
 *     from its own in-memory list on the next mutation. So the row was invisible
 *     until a reload and usually destroyed before one.
 *  3. The row carried no `action_type`, so anything that did survive to the panel
 *     was categorised "system" — a liquidation warning filed under maintenance
 *     notices, which is the one placement taxonomy.ts exists to prevent.
 *  4. It called `Notification.requestPermission()` and `new Notification(...)`
 *     itself, with no presence check, no `tag` and no `onclick` — reintroducing
 *     all four defects deliver.ts documents as fixed, from four live call sites.
 *
 * Everything now goes through the store, which categorises, de-duplicates,
 * persists and then hands off to deliver.ts's presence ladder. There is no
 * network hop, so these functions are synchronous: the old ones were `async`
 * only because of the POST, and no call site ever awaited them.
 */

/** What a caller supplies. Everything derived — id, timestamp — is the store's. */
export interface LocalNotification {
  title: string;
  body: string;
  level: "info" | "success" | "warning" | "error";
  /**
   * A key from taxonomy.ts's map. It decides the tab and, for "risk", the
   * delivery treatment — so an unrecognised value is not cosmetic, it demotes
   * the notification to the System tab.
   */
  actionType: string;
  /**
   * Record it, don't announce it.
   *
   * Set for notifications about the user's own just-completed action, where the
   * call site has already shown a toast. Without this the presence ladder shows
   * a second toast for the same event three inches from the first one — the
   * duplicate-channel problem deliver.ts was written to end, arriving by a
   * different door.
   */
  quiet?: boolean;
}

type Emitter = (n: LocalNotification) => void;

let emitter: Emitter | null = null;

/**
 * Notifications raised before the provider registered.
 *
 * Bounded, and small on purpose. The provider sits above the whole app so this
 * queue is normally empty, but a poll that lands in the same commit as mount
 * would otherwise drop its notification silently — and the one most likely to
 * arrive that early is the health-factor warning, read on the first poll.
 */
let pending: LocalNotification[] = [];
const MAX_PENDING = 20;

/**
 * NotificationsProvider registers here on mount.
 *
 * A module-level slot rather than a hook, following `setOpenHandler` in
 * deliver.ts, because the callers are write hooks and a polling effect that have
 * no business taking a context dependency — and because `useNotifications`
 * throws outside the provider, which would turn a missing provider from "no
 * notifications" into "the app crashes on a successful transaction".
 */
export function setNotificationEmitter(fn: Emitter | null): void {
  emitter = fn;
  if (!fn) return;
  const queued = pending;
  pending = [];
  for (const n of queued) fn(n);
}

export function notify(n: LocalNotification): void {
  if (emitter) {
    emitter(n);
    return;
  }
  if (pending.length < MAX_PENDING) pending.push(n);
}

/* -------------------------------------------------------------------------- */
/* Senders                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * Each of these exists so that no call site writes a raw `action_type` string.
 * The taxonomy is checked in one place; a typo here is one wrong notification,
 * a typo at a call site is a category silently lost.
 *
 * Note which are quiet and which are not: the rule is who acted. Your own
 * transaction already told you it succeeded. A counterparty's did not.
 */

/**
 * The pre-liquidation warning — the one alert in this app that has to arrive.
 *
 * Loud regardless of what the user is doing, and `warning` rather than `error`
 * because nothing has been lost yet; that is the whole point of sending it.
 */
export function sendHealthFactorWarning(healthFactor: number): void {
  notify({
    title: "Health factor warning",
    body: `Your health factor is ${healthFactor.toFixed(3)}. Add collateral or repay to avoid liquidation.`,
    level: "warning",
    actionType: "health_factor_warning",
  });
}

/** Your own order reached the chain. Quiet — the call site toasts on receipt. */
export function sendLoanCreatedNotification(kind: "borrow" | "lending"): void {
  notify({
    title: kind === "borrow" ? "Borrow request posted" : "Lending offer posted",
    body:
      kind === "borrow"
        ? "Your request is live in the book and can now be funded."
        : "Your offer is live in the book and can now be taken.",
    level: "success",
    actionType: "loan_created",
    quiet: true,
  });
}

/** You funded someone. Quiet, for the same reason. */
export function sendLoanFilledNotification(): void {
  notify({
    title: "Request funded",
    body: "You funded a borrow request. It now appears under your lends.",
    level: "success",
    actionType: "loan_filled",
    quiet: true,
  });
}

/**
 * Somebody funded *you*. Loud — this is news, and the borrower took no action
 * that would have produced a toast.
 */
export function sendRequestFundedNotification(requestId: string): void {
  notify({
    title: "Your request was funded",
    body: `Request #${requestId} has been filled. The funds are in your wallet.`,
    level: "success",
    actionType: "loan_filled",
  });
}

/**
 * A loan you funded was paid down, in part or in full.
 *
 * Lender-only. The borrower's own repayment toasts in *their* browser and
 * produced nothing at all in yours — which is why `LoanRepayment` had to be
 * widened to index the lender before this could be sent at all; see
 * useProtocolEvents.
 *
 * Split on whether the loan closed, because those are different pieces of news
 * and only one of them is finished: a partial payment leaves the position open
 * and still exposed, so filing it under the same wording as "repaid" would tell
 * a lender to stop watching a loan that is still running. `info` rather than
 * `success` for that reason.
 *
 * Neither body carries the amount. This is delivered through the presence ladder
 * and can surface as an OS-level banner on a locked screen, where a position
 * size is not something to publish.
 */
export function sendLoanRepaidNotification(
  requestId: string,
  fullyRepaid: boolean,
): void {
  notify(
    fullyRepaid
      ? {
          title: "A loan you funded was repaid",
          body: `Request #${requestId} has been repaid in full. The funds are in your available balance.`,
          level: "success",
          actionType: "loan_repaid",
        }
      : {
          title: "Partial repayment received",
          body: `The borrower paid down part of request #${requestId}. It stays open until the balance is cleared.`,
          level: "info",
          actionType: "loan_repaid",
        },
  );
}

/**
 * A position was liquidated.
 *
 * Two roles, two different pieces of news, one action_type: as the borrower you
 * have lost collateral, as the lender you have been repaid out of it. Both are
 * "risk" — a lender whose loan closed early needs to know as much as the
 * borrower does, even though only one of them is losing money.
 */
export function sendLiquidationNotification(
  role: "borrower" | "lender",
  requestId: string,
): void {
  notify(
    role === "borrower"
      ? {
          title: "Position liquidated",
          body: `Request #${requestId} was liquidated and your collateral was sold to repay it.`,
          level: "error",
          actionType: "liquidation",
        }
      : {
          title: "A loan you funded was liquidated",
          body: `Request #${requestId} was liquidated. Your repayment came out of the borrower's collateral.`,
          level: "warning",
          actionType: "liquidation",
        },
  );
}
