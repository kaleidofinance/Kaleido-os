"use client";

/**
 * Raises a notification for each new product-update announcement — once per
 * browser. Checks on load and every few minutes; works with no wallet
 * connected. What counts as "new" is decided by unseenAnnouncements.
 */
import { useEffect } from "react";
import {
  unseenAnnouncements,
  type Announcement,
} from "@/lib/notifications/announcements";
import { sendProductUpdateNotification } from "@/lib/notifications/emit";

const KEY = "kaleido_announcements_seen";
const POLL_MS = 5 * 60_000;

function loadSeen(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

export default function useAnnouncements(): void {
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/announcements");
        if (!res.ok || cancelled) return;
        const { announcements } = (await res.json()) as {
          announcements: Announcement[];
        };
        const { show, nextSeen } = unseenAnnouncements(
          announcements ?? [],
          loadSeen(),
          Date.now(),
        );
        if (nextSeen !== null) {
          try {
            localStorage.setItem(KEY, String(nextSeen));
          } catch {
            /* storage blocked: worst case it shows again next visit */
          }
        }
        for (const a of show) sendProductUpdateNotification(a.title, a.body, a.url);
      } catch {
        /* offline — try again next poll */
      }
    };
    void check();
    const id = window.setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
}
