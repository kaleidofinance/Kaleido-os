"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import {
  getPrefs,
  osPermission,
  requestOsPermission,
  setPrefs,
  type NotificationPrefs,
  type OsPermission,
} from "@/lib/notifications/deliver";
import { pushSupported, subscribePush } from "@/lib/notifications/push";
import Portal from "./Portal";
import PlanReview from "./PlanReview";
import NotificationRow from "./NotificationRow";
import s from "./NotificationCenter.module.css";

/**
 * The glance-and-act surface. /notifications remains the full history; this is
 * what you open from the nav to see what happened and answer what's asking.
 *
 * Portalled, and that is load-bearing rather than stylistic: the nav is a glass
 * surface, and Portal.tsx documents why a `position: fixed` overlay rendered
 * inside one gets clipped to the nav strip instead of covering the viewport.
 */

type Tab = "all" | Category;
const TABS: Tab[] = ["all", ...CATEGORY_ORDER];

interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
}

export default function NotificationCenter({
  open,
  onClose,
}: NotificationCenterProps) {
  const {
    notifications,
    unreadCount,
    focusedId,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    resolveRequest,
  } = useNotifications();

  const { address } = useWalletV2();
  const { settings, update } = useAgentSettings(address);

  const [tab, setTab] = useState<Tab>("all");
  const [reviewing, setReviewing] = useState<Notification | null>(null);
  const [perm, setPerm] = useState<OsPermission>("default");
  const [prefs, setLocalPrefs] = useState<NotificationPrefs>(getPrefs);
  const [enabling, setEnabling] = useState(false);

  /* Permission is read on open, not on mount: it can change in browser settings
     while the tab sits idle, and a stale "Enable" button that does nothing when
     clicked is worse than no button. */
  useEffect(() => {
    if (!open) return;
    setPerm(osPermission());
    setLocalPrefs(getPrefs());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape backs out of a review first. Closing the whole panel from inside
      // PlanReview would discard the context of what was being approved.
      if (reviewing) setReviewing(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, reviewing]);

  /* A notification clicked from the OS opens the panel with that id focused.
     Jump to the tab it lives in, or the row would be invisible behind a filter
     the user never chose. */
  useEffect(() => {
    if (!open || !focusedId) return;
    const hit = notifications.find((n) => n.id === focusedId);
    if (hit) setTab(hit.category);
  }, [open, focusedId, notifications]);

  useEffect(() => {
    if (!open) setReviewing(null);
  }, [open]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: unreadCount };
    for (const c of CATEGORY_ORDER) {
      map[c] = notifications.filter((n) => n.category === c && !n.read).length;
    }
    return map;
  }, [notifications, unreadCount]);

  const visible = useMemo(
    () =>
      tab === "all"
        ? notifications
        : notifications.filter((n) => n.category === tab),
    [notifications, tab],
  );

  if (!open) return null;

  /* ---------------------------------------------------------------- */
  /* Enabling OS delivery                                             */
  /* ---------------------------------------------------------------- */

  /**
   * The one place `Notification.requestPermission()` may be called.
   *
   * It is here, behind a click, because a gestureless request is rejected
   * outright by Safari and silently suppressed by Chrome — which is why the
   * previous implementation, which asked from inside a WebSocket message
   * handler, almost certainly never showed a prompt to anyone.
   */
  const enable = async () => {
    setEnabling(true);
    try {
      const result = await requestOsPermission();
      setPerm(result);
      if (result !== "granted") {
        toast.message(
          result === "denied"
            ? "Notifications are blocked for this site. Re-enable them in your browser's site settings."
            : "Notifications weren't enabled.",
        );
        return;
      }
      if (pushSupported()) {
        const ok = await subscribePush(address);
        toast[ok ? "success" : "message"](
          ok
            ? "Notifications on. You'll be reached even with the browser closed."
            : "Notifications on while the app is open. Background delivery isn't configured on this deployment.",
        );
      } else {
        toast.success("Notifications on while a tab is open.");
      }
    } finally {
      setEnabling(false);
    }
  };

  const togglePref = (patch: Partial<NotificationPrefs>) => {
    const next = setPrefs(patch);
    setLocalPrefs(next);
    // hideAmounts is also stored server-side per subscription, because the
    // server composes the push body and cannot read localStorage on a device
    // whose browser is shut. Re-post to keep the two in step.
    if ("hideAmounts" in patch && perm === "granted" && pushSupported()) {
      void subscribePush(address);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Answering a permission ask                                        */
  /* ---------------------------------------------------------------- */

  const onReview = (n: Notification) => {
    if (n.request?.kind === "limit" && n.request.limit) {
      const { field, requested } = n.request.limit;
      /*
       * This raises the cap and leaves it raised, and the copy below says so.
       *
       * A true one-shot allowance has nowhere to live: AgentSettings holds
       * standing limits, not a consumable grant, and inventing a hidden
       * per-request budget would mean a second source of truth that the
       * server-side auditor gate in /api/chat knows nothing about. Raising a
       * limit the user can see and lower again is honest; a silent temporary
       * grant that expires by a rule nobody can inspect is not.
       */
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

    // A plan request with no intents cannot be signed — there is nothing to
    // sign. Say so rather than opening an empty review.
    toast.error("This request arrived without any steps to review.");
  };

  const onDeny = (n: Notification) => {
    resolveRequest(n.id, "denied");
    toast.message("Denied. Nothing was signed.");
  };

  const currentCap = `$${settings.maxPerAction.toLocaleString()} per action`;

  return (
    <Portal>
      <div className={s.overlay} onClick={onClose} role="presentation">
        <div
          className={s.modal}
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={s.mh}>
            {reviewing ? (
              <>
                <button
                  className={s.back}
                  onClick={() => setReviewing(null)}
                  aria-label="Back to notifications"
                >
                  ‹
                </button>
                <span className={s.mt}>Review request</span>
              </>
            ) : (
              <span className={s.mt}>Notifications</span>
            )}
            <button className={s.mx} onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          {reviewing ? (
            <div className={s.review}>
              {reviewing.request?.summary && (
                <p className={s.summary}>{reviewing.request.summary}</p>
              )}
              {currentCap && <p className={s.cap}>Your limit: {currentCap}</p>}{" "}
              <PlanReview
                intents={reviewing.request?.intents ?? []}
                submitLabel="Sign & execute"
                onComplete={() => {
                  resolveRequest(reviewing.id, "approved");
                  setReviewing(null);
                }}
                onCancel={() => setReviewing(null)}
              />
            </div>
          ) : (
            <>
              <div className={s.tabs} role="tablist" aria-label="Category">
                {TABS.map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    className={`${s.tg} ${tab === t ? s.on : ""}`}
                    onClick={() => setTab(t)}
                  >
                    {t === "all" ? "All" : CATEGORY_LABELS[t]}
                    {counts[t] > 0 && <i className={s.pip}>{counts[t]}</i>}
                  </button>
                ))}
              </div>

              {perm !== "granted" && perm !== "unsupported" && (
                <div className={s.optIn}>
                  <div className={s.optCopy}>
                    <strong>Get notified when you're away</strong>
                    <span>
                      Permission asks and liquidation warnings reach you when
                      this tab isn't in front of you.
                    </span>
                  </div>
                  <button
                    className={s.optBtn}
                    onClick={enable}
                    disabled={enabling || perm === "denied"}
                  >
                    {perm === "denied" ? "Blocked" : enabling ? "…" : "Enable"}
                  </button>
                </div>
              )}

              <div className={s.list}>
                {visible.length === 0 ? (
                  <div className={s.empty}>
                    {tab === "all"
                      ? "Nothing yet."
                      : `No ${CATEGORY_LABELS[tab as Category].toLowerCase()} notifications.`}
                  </div>
                ) : (
                  visible.map((n) => (
                    <NotificationRow
                      key={n.id}
                      n={n}
                      focused={n.id === focusedId}
                      onOpen={() => markAsRead(n.id)}
                      onReview={onReview}
                      onDeny={onDeny}
                      onDelete={deleteNotification}
                    />
                  ))
                )}
              </div>

              <div className={s.prefs}>
                <label className={s.pref}>
                  <input
                    type="checkbox"
                    checked={prefs.sound}
                    onChange={(e) => togglePref({ sound: e.target.checked })}
                  />
                  Sound when away
                </label>
                <label
                  className={s.pref}
                  title="Amounts still show in the app."
                >
                  <input
                    type="checkbox"
                    checked={prefs.hideAmounts}
                    onChange={(e) =>
                      togglePref({ hideAmounts: e.target.checked })
                    }
                  />
                  Hide amounts on lock screen
                </label>
              </div>

              <div className={s.mf}>
                <Link href="/notifications" className={s.see} onClick={onClose}>
                  See all
                </Link>
                <span className={s.spacer} />
                <button
                  className={s.act}
                  onClick={markAllAsRead}
                  disabled={unreadCount === 0}
                >
                  Mark all read
                </button>
                <button
                  className={s.act}
                  onClick={clearAll}
                  disabled={notifications.length === 0}
                >
                  Clear
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}
