/**
 * Product-update announcements: which ones this browser should be told about.
 *
 * Pure, so the "once per browser" and "a first visit doesn't replay history"
 * rules are pinned by announcements.test.ts. The hook (useAnnouncements) owns
 * the fetch and the localStorage marker; this decides.
 */
export interface Announcement {
  id: number;
  title: string;
  body: string;
  url: string | null;
  publishedAt: string;
}

/** A first-time visitor only hears about updates this recent. */
export const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** And at most this many at once, newest first, so a first visit isn't a flood. */
export const FIRST_VISIT_MAX = 3;

/**
 * The announcements to show now, oldest first, and the marker to store.
 *
 * `lastSeen` is the highest id this browser has already shown, or null for a
 * browser that has never checked. A known browser gets everything newer than
 * its marker; a new one gets only the last FIRST_VISIT_MAX from the last week.
 */
export function unseenAnnouncements(
  list: readonly Announcement[],
  lastSeen: number | null,
  now: number,
): { show: Announcement[]; nextSeen: number | null } {
  const maxId = list.reduce((m, a) => Math.max(m, a.id), lastSeen ?? 0);
  let fresh: Announcement[];
  if (lastSeen === null) {
    fresh = list
      .filter((a) => now - new Date(a.publishedAt).getTime() <= FRESH_MS)
      .sort((a, b) => b.id - a.id)
      .slice(0, FIRST_VISIT_MAX);
  } else {
    fresh = list.filter((a) => a.id > lastSeen);
  }
  return {
    show: fresh.sort((a, b) => a.id - b.id),
    nextSeen: list.length > 0 || lastSeen !== null ? maxId : null,
  };
}
