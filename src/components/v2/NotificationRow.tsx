"use client";

import { CATEGORY_LABELS } from "@/lib/notifications/taxonomy";
import type { Notification } from "@/context/NotificationsContext";
import s from "./NotificationRow.module.css";

/**
 * One notification, rendered the same way in the nav panel and on
 * /notifications.
 *
 * Shared deliberately: two renderers for the same record drift, and the way
 * they drift is that one of them quietly stops showing the Approve/Deny pair.
 * A permission ask that is actionable in one place and inert in the other is
 * worse than one that is inert in both, because nobody notices.
 */

interface NotificationRowProps {
  n: Notification;
  /** Open/expand. Marks read. */
  onOpen?: (n: Notification) => void;
  /** kind:"plan" — hands off to PlanReview. kind:"limit" — resolves in place. */
  onReview?: (n: Notification) => void;
  onDeny?: (n: Notification) => void;
  onDelete?: (id: string) => void;
  /** Draws attention when arrived at via a notification click. */
  focused?: boolean;
}

/**
 * Relative time, coarse on purpose.
 *
 * "14:32" tells you nothing without knowing the current time, and a full
 * timestamp on every row turns a list into a table. Past a day this falls back
 * to a date, because "9d" stops being a useful unit.
 */
function ago(ts: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function NotificationRow({
  n,
  onOpen,
  onReview,
  onDeny,
  onDelete,
  focused,
}: NotificationRowProps) {
  const pending = n.request?.status === "pending";

  /*
   * "Review", never "Approve", for a signable plan.
   *
   * A plan needs a wallet signature to run, so this button cannot approve
   * anything — it can only open PlanReview and show you the steps. A button
   * labelled Approve that then raises a wallet prompt misdescribes the click,
   * and the place you least want a user surprised is the one where they are
   * about to sign. A limit request is a local guardrail in useAgentSettings, so
   * there Approve is literally true.
   */
  const approveLabel = n.request?.kind === "limit" ? "Approve" : "Review";

  return (
    <div
      className={[
        s.row,
        n.read ? "" : s.unread,
        focused ? s.focused : "",
        pending ? s.asking : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        className={s.main}
        onClick={() => onOpen?.(n)}
        aria-label={`${n.read ? "" : "Unread. "}${n.title}`}
      >
        <span className={`${s.dot} ${s[n.level]}`} aria-hidden="true" />
        <span className={s.body}>
          <span className={s.head}>
            <span className={s.title}>{n.title}</span>
            <span className={s.time}>{ago(n.timestamp)}</span>
          </span>
          {n.body && <span className={s.text}>{n.body}</span>}
          <span className={s.meta}>
            <span className={`${s.chip} ${s[`c_${n.category}`]}`}>
              {CATEGORY_LABELS[n.category]}
            </span>
            {n.request?.status === "approved" && (
              <span className={s.resolved}>Approved</span>
            )}
            {n.request?.status === "denied" && (
              <span className={s.resolved}>Denied</span>
            )}
          </span>
        </span>
      </button>

      {pending && (
        <div className={s.actions}>
          <button className={s.deny} onClick={() => onDeny?.(n)}>
            Deny
          </button>
          <button className={s.approve} onClick={() => onReview?.(n)}>
            {approveLabel}
          </button>
        </div>
      )}

      {onDelete && (
        <button
          className={s.kill}
          onClick={() => onDelete(n.id)}
          aria-label={`Dismiss "${n.title}"`}
          title="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}
