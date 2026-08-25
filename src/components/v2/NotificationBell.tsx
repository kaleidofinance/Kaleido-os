"use client";

import { useNotifications } from "@/context/NotificationsContext";
import s from "./NotificationBell.module.css";

/**
 * The entry point the notification centre never had.
 *
 * /notifications has existed as a route for a while with nothing linking to it —
 * seven nav links, none of them this. The badge reads from the derived
 * `unreadCount`, not a stored counter, which is why it can no longer disagree
 * with the list it summarises.
 */
export default function NotificationBell() {
  const { unreadCount, openPanel, panelOpen } = useNotifications();

  const label =
    unreadCount === 0
      ? "Notifications"
      : `Notifications, ${unreadCount} unread`;

  return (
    <button
      className={`${s.bell} ${panelOpen ? s.on : ""}`}
      onClick={() => openPanel()}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={panelOpen}
    >
      {/* Inline rather than <img src="/notifications.svg">: the icon has to take
          currentColor to track the theme and the hover state, which an <img>
          cannot do. The file stays as the OS notification's icon, where it is
          rendered by the system and cannot inherit anything. */}
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>

      {unreadCount > 0 && (
        <span className={s.badge} aria-hidden="true">
          {/* Capped: a three-digit badge stops being a number and becomes a
              smear, and past nine the exact count changes no decision. */}
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  );
}
