"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useNotifications,
  type Notification,
} from "@/context/NotificationsContext";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { useAgentSettings } from "@/hooks/v2/useAgentSettings";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type Category,
} from "@/lib/notifications/taxonomy";
import NotificationRow from "@/components/v2/NotificationRow";
import PlanReview from "@/components/v2/PlanReview";
import s from "./notifications.module.css";

/**
 * Full history. The nav panel is for glancing and answering; this is where you
 * come to find something from last week.
 *
 * Ported off hardcoded Tailwind onto the token set. The previous version painted
 * `bg-black` with `#18181b` cards and `text-gray-*` copy, which is a black slab
 * in light mode — the tokens exist precisely so a surface cannot be written that
 * only works in one theme. Rows now come from the same NotificationRow the panel
 * uses, so the two cannot drift over whether a permission ask is answerable.
 */

type ReadFilter = "all" | "unread" | "read";
type LevelFilter = "all" | "info" | "warning" | "error" | "success";
type CatFilter = "all" | Category;

export default function NotificationsPage() {
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    resolveRequest,
  } = useNotifications();

  const { address } = useWalletV2();
  const { update } = useAgentSettings(address);

  const [cat, setCat] = useState<CatFilter>("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [reviewing, setReviewing] = useState<Notification | null>(null);

  const visible = useMemo(
    () =>
      notifications.filter((n) => {
        if (cat !== "all" && n.category !== cat) return false;
        if (readFilter === "unread" && n.read) return false;
        if (readFilter === "read" && !n.read) return false;
        if (level !== "all" && n.level !== level) return false;
        return true;
      }),
    [notifications, cat, readFilter, level],
  );

  /* Identical semantics to the panel — see NotificationCenter for why a plan
     says Review and only a limit says Approve. */
  const onReview = (n: Notification) => {
    if (n.request?.kind === "limit" && n.request.limit) {
      const { field, requested } = n.request.limit;
      update({ [field]: requested });
      resolveRequest(n.id, "approved");
      toast.success(
        `${field === "maxPerAction" ? "Per-action" : "Daily"} limit is now $${requested.toLocaleString()}.`,
      );
      return;
    }
    if (n.request?.intents?.length) {
      setReviewing(n);
      markAsRead(n.id);
      return;
    }
    toast.error("This request arrived without any steps to review.");
  };

  const onDeny = (n: Notification) => {
    resolveRequest(n.id, "denied");
    toast.message("Denied. Nothing was signed.");
  };

  if (reviewing) {
    return (
      <div className={s.wrap}>
        <button className={s.back} onClick={() => setReviewing(null)}>
          ‹ Back to notifications
        </button>
        <section className={s.card}>
          <h1 className={s.h1}>Review request</h1>
          {reviewing.request?.summary && (
            <p className={s.sub}>{reviewing.request.summary}</p>
          )}
          <PlanReview
            intents={reviewing.request?.intents ?? []}
            submitLabel="Sign & execute"
            onComplete={() => {
              resolveRequest(reviewing.id, "approved");
              setReviewing(null);
            }}
            onCancel={() => setReviewing(null)}
          />
        </section>
      </div>
    );
  }

  return (
    <div className={s.wrap}>
      <header className={s.head}>
        <div>
          <h1 className={s.h1}>Notifications</h1>
          <p className={s.sub}>
            {unreadCount} unread · {notifications.length} total
          </p>
        </div>
        <div className={s.headActions}>
          <button
            className={s.ghost}
            onClick={markAllAsRead}
            disabled={unreadCount === 0}
          >
            Mark all read
          </button>
          <button
            className={s.ghost}
            onClick={clearAll}
            disabled={notifications.length === 0}
          >
            Clear all
          </button>
        </div>
      </header>

      <div className={s.toggle} role="tablist" aria-label="Category">
        {(["all", ...CATEGORY_ORDER] as CatFilter[]).map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={cat === c}
            className={`${s.tg} ${cat === c ? s.on : ""}`}
            onClick={() => setCat(c)}
          >
            {c === "all" ? "All" : CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div className={s.filters}>
        <label className={s.field}>
          <span>Status</span>
          <select
            className={s.select}
            value={readFilter}
            onChange={(e) => setReadFilter(e.target.value as ReadFilter)}
          >
            <option value="all">All</option>
            <option value="unread">Unread only</option>
            <option value="read">Read only</option>
          </select>
        </label>
        <label className={s.field}>
          <span>Level</span>
          <select
            className={s.select}
            value={level}
            onChange={(e) => setLevel(e.target.value as LevelFilter)}
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="success">Success</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </label>
      </div>

      <section className={s.card}>
        {visible.length === 0 ? (
          <div className={s.empty}>
            <p className={s.emptyTitle}>No notifications</p>
            <p className={s.sub}>
              {notifications.length === 0
                ? "You'll see agent requests, orders and risk alerts here as they arrive."
                : "Nothing matches these filters."}
            </p>
          </div>
        ) : (
          visible.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              onOpen={() => markAsRead(n.id)}
              onReview={onReview}
              onDeny={onDeny}
              onDelete={deleteNotification}
            />
          ))
        )}
      </section>
    </div>
  );
}
