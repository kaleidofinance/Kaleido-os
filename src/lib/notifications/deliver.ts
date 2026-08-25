"use client";

/**
 * Delivery — decides *how* a notification reaches you, based on whether you are
 * actually at the screen.
 *
 * The rule this file exists to enforce: **exactly one channel per notification.**
 * The old code called `new Notification(...)` on every WebSocket message with no
 * presence check at all, so a user staring at the tab got an OS toast for
 * something already visible three inches away, plus a chime. That is the
 * behaviour that trains people to switch notifications off.
 *
 *   at the screen        → in-app only (badge + sonner). No OS toast, no sound.
 *   tab hidden/unfocused → page-level Notification
 *   browser closed       → service-worker push (see public/sw.js)
 *
 * Three more fixes ride along, all of them things the previous implementation
 * got wrong and all of them visible:
 *
 *   `tag`  — without it, five updates about one loan stack five OS toasts.
 *            With it, an update *replaces* its predecessor.
 *   `onclick` — there wasn't one, so clicking a toast did nothing at all. A
 *            notification you can't click is a strictly worse dialog box.
 *   permission — `Notification.requestPermission()` was called from inside a
 *            WebSocket message handler. Safari rejects a request with no user
 *            gesture outright, and Chrome silently suppresses the prompt for
 *            sites without engagement, so on both the prompt most likely never
 *            appeared and the whole feature was dead. It now lives behind an
 *            explicit button — see `requestOsPermission`.
 */

import { toast } from "sonner";
import type { Category } from "./taxonomy";
import { redactAmounts } from "./redact";

export { redactAmounts };

export interface DeliverPayload {
  id: string;
  title: string;
  body: string;
  level: "info" | "warning" | "error" | "success";
  category: Category;
  /** True when this carries a pending agent permission ask. */
  actionable?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

export interface NotificationPrefs {
  /** Two-tone chime when a notification arrives while you're away. */
  sound: boolean;
  /**
   * Strip amounts from anything that renders outside the app.
   *
   * On by default, and the default is the point. Web-push payloads are
   * end-to-end encrypted to the subscriber, so an amount is safe *in transit* —
   * but the notification body renders on a lock screen, in public, to anyone
   * standing behind you. This app already refuses to publish USD position sizes
   * anywhere else for exactly that reason; a lock screen is not an exception.
   */
  hideAmounts: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  sound: true,
  hideAmounts: true,
};

const PREFS_KEY = "kaleido.notifications.prefs";

export function getPrefs(): NotificationPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return {
      ...DEFAULT_PREFS,
      ...(JSON.parse(raw) as Partial<NotificationPrefs>),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setPrefs(patch: Partial<NotificationPrefs>): NotificationPrefs {
  const next = { ...getPrefs(), ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable — preference stays in-memory for this tab */
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Presence                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `visibilityState` alone is not enough. A tab can be "visible" while the whole
 * browser window sits behind your editor — visible means "not in a background
 * tab", not "being looked at". `hasFocus()` is what closes that gap, and it is
 * the difference between a notification that feels attentive and one that feels
 * like it's shouting at someone already listening.
 */
export function isPresent(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}

/* -------------------------------------------------------------------------- */
/* Sound                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Two-tone chime. Lifted from notificationService.ts so there is one copy, and
 * gated on presence + preference by the caller rather than firing on every
 * message the way the original did.
 */
export function playChime(): void {
  try {
    if (typeof window === "undefined") return;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();

    const tone = (frequency: number, duration: number, delay: number) => {
      window.setTimeout(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(frequency, ctx.currentTime);
        osc.type = "sine";
        // Ramped rather than switched, so it fades instead of clicking.
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.01);
        gain.gain.linearRampToValueAtTime(
          0.1,
          ctx.currentTime + duration - 0.01,
        );
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
      }, delay);
    };

    tone(800, 0.15, 0);
    tone(600, 0.2, 100);
  } catch {
    /* autoplay policy, no audio device — a missing chime is not worth an error */
  }
}

/* -------------------------------------------------------------------------- */
/* OS permission                                                              */
/* -------------------------------------------------------------------------- */

export type OsPermission = "unsupported" | "default" | "granted" | "denied";

export function osPermission(): OsPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission as OsPermission;
}

/**
 * Must be called from a real user gesture — a click handler, nothing else.
 * See the header comment for why the previous call site could never work.
 */
export async function requestOsPermission(): Promise<OsPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  try {
    return (await Notification.requestPermission()) as OsPermission;
  } catch {
    return "denied";
  }
}

/* -------------------------------------------------------------------------- */
/* Deep links                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Where a click should land. Everything routes through `?notif=<id>` rather
 * than a per-category page, because the thing you want on arrival is the
 * notification itself — and for an agent permission ask, the panel *is* the
 * place the ask is answered.
 */
export function deepLink(id: string): string {
  return `/trade?notif=${encodeURIComponent(id)}`;
}

/* -------------------------------------------------------------------------- */
/* Delivery                                                                   */
/* -------------------------------------------------------------------------- */

/** Called when the user activates a delivered notification. */
export type OpenHandler = (id: string) => void;

let openHandler: OpenHandler | null = null;

/**
 * The provider registers the panel opener here. Kept as a module-level slot
 * rather than threaded through every call because the OS notification's
 * `onclick` fires long after the React render that created it, and closing over
 * a stale setState from that render is how "clicking does nothing sometimes"
 * bugs start.
 */
export function setOpenHandler(fn: OpenHandler | null): void {
  openHandler = fn;
}

function openInApp(id: string) {
  if (openHandler) {
    openHandler(id);
    return;
  }
  // No panel mounted (rare — it lives in the nav). Navigate instead of dropping
  // the click on the floor.
  if (typeof window !== "undefined") window.location.assign(deepLink(id));
}

/**
 * Shows a page-level OS notification. Only reached when the user is away and
 * permission is already granted; it never prompts.
 */
function deliverAway(p: DeliverPayload): boolean {
  if (osPermission() !== "granted") return false;
  try {
    const prefs = getPrefs();
    const body = prefs.hideAmounts ? redactAmounts(p.body) : p.body;

    const n = new Notification(p.title, {
      body,
      icon: "/notifications.svg",
      badge: "/notifications.svg",
      // One notification per subject. An update to a loan replaces the previous
      // one instead of adding a fourth copy of the same story.
      tag: `kaleido:${p.category}:${p.id}`,
      data: { id: p.id, url: deepLink(p.id) },
      // A permission ask must survive the auto-dismiss timeout — it is a
      // question, and a question that vanishes unanswered is worse than one
      // never asked. Everything else may fade.
      requireInteraction: p.actionable === true,
    } as NotificationOptions);

    n.onclick = () => {
      // focus() first: on Windows and Linux the window will not raise once the
      // notification has been closed.
      window.focus();
      n.close();
      openInApp(p.id);
    };
    return true;
  } catch {
    return false;
  }
}

/** In-app surfacing for a user who is already looking at the app. */
function deliverPresent(p: DeliverPayload) {
  const opts = {
    description: p.body || undefined,
    action: {
      label: p.actionable ? "Review" : "View",
      onClick: () => openInApp(p.id),
    },
  };
  if (p.level === "error") toast.error(p.title, opts);
  else if (p.level === "warning") toast.warning(p.title, opts);
  else if (p.level === "success") toast.success(p.title, opts);
  else toast(p.title, opts);
}

/**
 * The ladder. Returns which rung was used, so callers can log or test it.
 *
 * Note what happens when the user is away but permission is still "default":
 * we fall back to the in-app toast rather than prompting. Prompting here is
 * exactly the bug this file was written to fix, and a prompt fired at someone
 * who isn't looking is a prompt they will dismiss without reading.
 */
export function deliver(p: DeliverPayload): "present" | "away" | "silent" {
  if (isPresent()) {
    deliverPresent(p);
    return "present";
  }
  const shown = deliverAway(p);
  if (getPrefs().sound) playChime();
  return shown ? "away" : "silent";
}
