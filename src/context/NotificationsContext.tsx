"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { useActiveAccount } from "thirdweb/react";
import {
  categorise,
  readActionType,
  type Category,
  type NotificationRequest,
} from "@/lib/notifications/taxonomy";
import { deliver, setOpenHandler } from "@/lib/notifications/deliver";
import {
  setNotificationEmitter,
  type LocalNotification,
} from "@/lib/notifications/emit";
import { MOCK_DATA, mockNotifications } from "@/lib/mock";

/**
 * The notification centre's single source of truth.
 *
 * This file was rewritten rather than extended, because the previous version had
 * four defects that were each individually invisible and collectively fatal to
 * a notification centre:
 *
 *  1. It leaked a WebSocket and two intervals per mount. The effect declared an
 *     outer `connectWebSocket` that declared an *inner* one, duplicated the
 *     history fetch and the 60s sync, and returned its cleanup from the inner
 *     function instead of from the effect — so nothing was ever torn down, the
 *     socket's `onclose` reconnected every 5s, and the sockets compounded. With
 *     an OS-notification layer on top, that means duplicate toasts, one per
 *     leaked socket, growing for as long as the tab stays open.
 *  2. Its effect had `[]` deps and read the wallet once from localStorage, so
 *     connecting a wallet after page load never started notifications. The bell
 *     would have sat at zero forever for exactly the users who just arrived.
 *  3. `unreadCount` was separate stored state that drifted: `markAsRead`
 *     decremented unconditionally whether or not the item was unread, and
 *     `setUnreadCount` was called *inside* `setNotifications` updaters — a side
 *     effect in a reducer, run twice under StrictMode. The badge is the feature;
 *     it is now derived, which deletes the whole class of bug.
 *  4. It read `metadata.action_type` into a commented-out debug log and then
 *     dropped it, so the categories the backend was already sending never
 *     reached the UI.
 *
 * Two more surfaced once the store was the only writer, both in the transport:
 * the host fell back to `window.location.origin`, where Next serves neither
 * `/ws/receiver` nor `/notifications/history`, so every user paid a permanent
 * reconnect loop and a 60s 404 poll; and the history sync returned the server's
 * rows alone, which deleted anything raised in this browser. See the transport
 * effect and `origin` on Notification.
 */

export interface Notification {
  id: string;
  title: string;
  body: string;
  level: "info" | "warning" | "error" | "success";
  timestamp: number;
  read: boolean;
  category: Category;
  /** Raw backend action_type, kept so an unmapped value is debuggable. */
  actionType?: string;
  /** Present when this notification is an agent permission ask. */
  request?: NotificationRequest;
  /**
   * Where the row came from.
   *
   * "local" means it was raised in this browser by emit.ts and the server has
   * never heard of it. The history sync therefore must not treat its own list as
   * authoritative over these — see fetchHistory, where replacing the list
   * wholesale used to delete every locally-raised notification within 60s.
   */
  origin?: "local" | "remote";
}

interface NotificationsContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  deleteNotification: (id: string) => void;
  clearAll: () => void;
  /** Records the outcome of a permission ask so the row stops asking. */
  resolveRequest: (id: string, status: "approved" | "denied") => void;
  /**
   * Raises a notification from inside this browser.
   *
   * Also registered into emit.ts's module slot, which is how write hooks and
   * polling effects reach it without taking a context dependency. Exposed here
   * too so a component that already has the context doesn't need the slot.
   */
  notifyLocal: (n: LocalNotification) => void;
  /* Panel state lives here so the nav bell, a clicked OS notification and the
     service worker can all drive one panel without prop-drilling through Nav. */
  panelOpen: boolean;
  focusedId: string | null;
  openPanel: (id?: string) => void;
  closePanel: () => void;
}

const NotificationsContext = createContext<
  NotificationsContextType | undefined
>(undefined);

const STORAGE_KEY = "kaleido_notifications";
const MAX_STORED = 50;

/* -------------------------------------------------------------------------- */
/* Storage                                                                    */
/* -------------------------------------------------------------------------- */

function loadStored(): Notification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Notifications persisted before this field existed have no category, and
    // trusting a stored value would also pin anything mis-categorised by an old
    // build. Re-deriving from actionType on every load keeps one rule in one
    // place — taxonomy.ts — rather than two that can disagree.
    return (
      parsed
        // Demo rows are never restored. NEXT_PUBLIC_MOCK_DATA seeds fixture
        // notifications straight into state (see the transport effect), and any
        // mutation on one — marking it read, resolving its request — goes through
        // `commit`, which persists. Without this line those rows outlive the flag:
        // switch it off and yesterday's fixtures are still in the bell with nothing
        // left in the code to explain them. Deliberately not gated on the flag, so
        // it still cleans up after `src/lib/mock` has been deleted outright.
        .filter((n: Notification) => !n?.id?.startsWith("mock-"))
        .map((n: Notification) => ({
          ...n,
          category: categorise(n.actionType),
        }))
    );
  } catch {
    return [];
  }
}

function saveStored(list: Notification[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(list.slice(0, MAX_STORED)),
    );
  } catch {
    /* quota exceeded or storage disabled — notifications stay in memory */
  }
}

/**
 * Extracts an agent permission ask from a raw payload, if there is one.
 *
 * Returns undefined for the overwhelming majority of notifications — a filled
 * loan is news, not a question. Only a payload that explicitly carries a
 * `request` becomes actionable, so a backend that knows nothing about this
 * feature can never accidentally produce a row with Approve/Deny buttons.
 */
function parseRequest(
  raw: Record<string, any>,
): NotificationRequest | undefined {
  const r = raw?.metadata?.request ?? raw?.request;
  if (!r || (r.kind !== "plan" && r.kind !== "limit")) return undefined;
  return {
    kind: r.kind,
    summary: typeof r.summary === "string" ? r.summary : "",
    intents: Array.isArray(r.intents) ? r.intents : undefined,
    limit: r.limit,
    // Always starts pending. A backend claiming something is already approved
    // would let a signal skip the one gate this feature exists to provide.
    status: "pending",
  };
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  /*
   * The wallet comes from thirdweb, not from a one-shot localStorage read.
   *
   * The old code read `localStorage.kaleidoAddress` once inside a `[]` effect,
   * which is why connecting a wallet mid-session never started notifications:
   * nothing re-ran. A hook value re-renders, so the transport effect below
   * re-subscribes on its own when the address changes.
   */
  const account = useActiveAccount();
  const address = account?.address;

  /*
   * Two mirrors of render state, both read from callbacks that outlive the
   * render that created them.
   *
   * `addressRef` — the WebSocket's onmessage fires between renders; reading
   *   `address` from the closure would compare an incoming target_user against
   *   whatever wallet was connected when the socket opened.
   * `listRef` — lets handleSignal answer "have I already seen this?"
   *   synchronously. A setState updater cannot: it runs during the next render
   *   pass, after the function that would act on its answer has returned.
   */
  const addressRef = useRef<string | undefined>(address);
  addressRef.current = address;

  const listRef = useRef<Notification[]>([]);

  /* Derived, never stored. See defect 3 in the file header. */
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  /**
   * Keeps listRef in step with committed state.
   *
   * Deliberately an effect rather than an assignment inside `commit`'s updater:
   * a reducer that writes to a ref is the same category of mistake as the
   * original's `setUnreadCount` inside `setNotifications`, and React may run an
   * updater for a render it later discards. The cost is that listRef trails by
   * one paint, which is exactly the window handleSignal documents and the
   * authoritative check inside `commit` covers.
   */
  useEffect(() => {
    listRef.current = notifications;
  }, [notifications]);

  /** Single writer: every mutation goes through here so persistence can't drift. */
  const commit = useCallback(
    (updater: (prev: Notification[]) => Notification[]) => {
      setNotifications((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        saveStored(next);
        return next;
      });
    },
    [],
  );

  const openPanel = useCallback((id?: string) => {
    setFocusedId(id ?? null);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setFocusedId(null);
  }, []);

  /* ------------------------------------------------------------------ */
  /* Mutations                                                          */
  /* ------------------------------------------------------------------ */

  const markAsRead = useCallback(
    (id: string) => {
      commit((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
    },
    [commit],
  );

  const markAllAsRead = useCallback(() => {
    commit((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })));
  }, [commit]);

  const deleteNotification = useCallback(
    (id: string) => {
      commit((prev) => prev.filter((n) => n.id !== id));
    },
    [commit],
  );

  const clearAll = useCallback(() => {
    commit(() => []);
  }, [commit]);

  const resolveRequest = useCallback(
    (id: string, status: "approved" | "denied") => {
      commit((prev) =>
        prev.map((n) =>
          n.id === id && n.request
            ? { ...n, read: true, request: { ...n.request, status } }
            : n,
        ),
      );
    },
    [commit],
  );

  /* ------------------------------------------------------------------ */
  /* Add and announce                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Records a new notification and hands it to the delivery ladder.
   *
   * Shared by the WebSocket handler and the local emitter so the duplicate check
   * and the delivery hand-off cannot drift apart between the two ways a
   * notification arrives.
   *
   * The duplicate check runs twice, against two different sources, and both are
   * needed:
   *
   *   listRef  — read synchronously, so we know *now* whether to fire a chime
   *              and an OS toast. A setState updater cannot answer this: it runs
   *              during the next render pass, long after this function has
   *              returned, so a flag it sets is still false here.
   *   commit   — authoritative. It sees the real previous state, so the stored
   *              list can never gain a duplicate row.
   *
   * listRef trails by one commit inside a single tick, so two identical signals
   * in the same microtask can both pass the first check. The second catches the
   * row; the cost is one redundant toast in a narrow window, against a
   * guaranteed double chime the other way round.
   */
  const commitAndDeliver = useCallback(
    (incoming: Notification, announce: boolean) => {
      const isSame = (n: Notification) =>
        n.id === incoming.id ||
        (n.title === incoming.title && n.body === incoming.body);

      if (listRef.current.some(isSame)) return;

      commit((prev) =>
        prev.some(isSame) ? prev : [incoming, ...prev].slice(0, MAX_STORED),
      );

      /*
       * Delivery is a side effect, so it stays out of the updater. The original
       * called playNotificationSound() and setUnreadCount() *inside*
       * setNotifications, which meant both ran twice under StrictMode — a double
       * chime for one event. A reducer must be pure.
       */
      if (!announce) return;
      deliver({
        id: incoming.id,
        title: incoming.title,
        body: incoming.body,
        level: incoming.level,
        category: incoming.category,
        actionable: incoming.request?.status === "pending",
      });
    },
    [commit],
  );

  const notifyLocal = useCallback(
    (n: LocalNotification) => {
      commitAndDeliver(
        {
          id: uuidv4(),
          title: n.title,
          body: n.body,
          level: n.level,
          timestamp: Date.now(),
          read: false,
          category: categorise(n.actionType),
          actionType: n.actionType,
          origin: "local",
        },
        n.quiet !== true,
      );
    },
    [commitAndDeliver],
  );

  /*
   * The slot in emit.ts, which is what non-component callers use. Registering it
   * here also flushes anything raised before this effect ran — see the pending
   * queue there.
   */
  useEffect(() => {
    setNotificationEmitter(notifyLocal);
    return () => setNotificationEmitter(null);
  }, [notifyLocal]);

  /* ------------------------------------------------------------------ */
  /* Click targets: OS notification and service worker                  */
  /* ------------------------------------------------------------------ */

  /*
   * A clicked notification has to reach the panel from three places: an in-page
   * Notification's onclick, a service-worker postMessage, and a cold open with
   * ?notif=<id> in the URL. All three land here.
   */
  useEffect(() => {
    setOpenHandler((id) => {
      openPanel(id);
      markAsRead(id);
    });
    return () => setOpenHandler(null);
  }, [openPanel, markAsRead]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "kaleido:open-notification") {
        const id = event.data.id as string | undefined;
        openPanel(id);
        if (id) markAsRead(id);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [openPanel, markAsRead]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("notif");
    if (!id) return;
    openPanel(id);
    markAsRead(id);
    // Strip the param so a refresh doesn't reopen the panel, and so the URL
    // isn't shareable in a way that leaks a notification id.
    const url = new URL(window.location.href);
    url.searchParams.delete("notif");
    window.history.replaceState({}, "", url.toString());
  }, [openPanel, markAsRead]);

  /* ------------------------------------------------------------------ */
  /* WebSocket signal handling                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Three shapes arrive on /ws/receiver: delete, modify, and "anything with a
   * title" meaning add. Kept in one place so the socket's onmessage stays a
   * two-line parse-and-dispatch.
   */
  const handleSignal = useCallback(
    (data: Record<string, any>) => {
      if (!data) return;

      if (data.action === "delete") {
        commit((prev) =>
          prev.filter((n) => {
            if (data.target_id && n.id === data.target_id) return false;
            // Content fallback, kept from the original: older backend builds
            // send a title/body pair rather than an id.
            if (
              data.target_id &&
              ((data.original_title && n.title === data.original_title) ||
                (data.original_body && n.body === data.original_body))
            ) {
              return false;
            }
            return true;
          }),
        );
        return;
      }

      if (data.action === "modify") {
        commit((prev) => {
          let done = false;
          return prev.map((n) => {
            if (done || !data.modifications) return n;
            const byId = data.target_id && n.id === data.target_id;
            const byContent =
              (data.original_title && n.title === data.original_title) ||
              (data.original_body && n.body === data.original_body);
            if (!byId && !byContent) return n;
            done = true;
            return {
              ...n,
              title: data.modifications.title || n.title,
              body: data.modifications.body || n.body,
              timestamp: Date.now(),
            };
          });
        });
        return;
      }

      if (!data.title) return;

      /*
       * Security filter, preserved from the original with its behaviour intact:
       * a signal carrying `target_user` must match the connected wallet or it is
       * dropped. A signal *without* `target_user` is shown to everyone, which is
       * intended — that is the broadcast channel for maintenance and protocol
       * notices. Anything user-specific must carry the field. Notifications
       * raised in this browser never reach here; they go through notifyLocal,
       * where the wallet is already the one the store is keyed to.
       */
      const targetUser = data.metadata?.target_user || data.target_user;
      const current = addressRef.current;
      if (targetUser) {
        if (!current || targetUser.toLowerCase() !== current.toLowerCase()) {
          return;
        }
      }

      const actionType = readActionType(data);
      const incoming: Notification = {
        id: data.id || uuidv4(),
        title: data.title,
        body: data.body || "",
        level: data.level || "info",
        timestamp: Date.now(),
        read: false,
        category: categorise(actionType),
        actionType,
        request: parseRequest(data),
        origin: "remote",
      };

      commitAndDeliver(incoming, true);
    },
    [commitAndDeliver, commit],
  );

  /* ------------------------------------------------------------------ */
  /* Transport: history fetch, 60s sync, WebSocket                      */
  /* ------------------------------------------------------------------ */

  /*
   * One effect, one socket, one interval, and a cleanup that is actually
   * returned from the effect. Compare the original, which nested two
   * `connectWebSocket` functions, ran the history fetch and the sync interval
   * twice, and returned its teardown from the inner function where React never
   * saw it.
   *
   * Keyed on `address`: changing wallets tears the old subscription down and
   * starts a new one, which is also what makes a mid-session connect work.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!address) {
      // No wallet, no identity to filter on. Clear rather than show another
      // user's history from a previous session.
      setNotifications([]);
      saveStored([]);
      return;
    }

    // Mirrored for the WebSocket's own target_user check, which the backend
    // contract expects to find on `window`.
    (
      window as unknown as { kaleido_current_user_address?: string }
    ).kaleido_current_user_address = address;

    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let attempt = 0;

    setNotifications(loadStored());

    /*
     * Fixture inbox.
     *
     * Placed after the wallet guard, so no wallet still means no inbox, and after
     * the stored load so the two merge by timestamp rather than one replacing the
     * other. Seeded with `setNotifications` and not `commit`, which is the whole
     * point: commit persists, and these must not — `loadStored` above drops
     * `mock-` ids for the same reason. Nothing is handed to `deliver` either, so
     * ten rows do not arrive as ten OS toasts on every mount.
     *
     * Returning here skips the transport, which under this flag would return two
     * lines below anyway (no engine is configured in any env file). Deleting
     * ./mock deletes the block and the transport resumes unchanged.
     */
    if (MOCK_DATA) {
      setNotifications((prev) =>
        [
          ...mockNotifications(address).map((n) => ({
            ...n,
            category: categorise(n.actionType),
          })),
          ...prev,
        ]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, MAX_STORED),
      );
      return;
    }

    /*
     * No configured engine, no transport.
     *
     * This used to fall back to `window.location.origin`, which is the Next app
     * — and Next serves neither `/ws/receiver` nor `/notifications/history`. So
     * in every environment that hasn't configured an engine, which is all of them
     * (the variable appears in no env file), every user paid a WebSocket that
     * failed and reconnected on a capped backoff forever, plus a 404 fetch every
     * 60 seconds. Locally-raised notifications work either way; this is purely
     * the inbound half, and the seam stays for when the engine is wired.
     */
    const host = process.env.NEXT_PUBLIC_API_BASE;
    if (!host) return;

    const fetchHistory = async (isSync: boolean) => {
      try {
        const res = await fetch(
          `${host}/notifications/history?user_address=${encodeURIComponent(address)}`,
        );
        if (!res.ok || cancelled) return;
        const json = await res.json();
        const rows: unknown[] = json?.notifications ?? [];

        commit((prev) => {
          const mapped: Notification[] = rows.map((raw) => {
            const r = raw as Record<string, any>;
            const id = r.id || r.uuid || uuidv4();
            const existing = prev.find((p) => p.id === id);
            const actionType = readActionType(r);
            return {
              id,
              title: r.title || "",
              body: r.body || "",
              level: r.level || "info",
              timestamp: r.timestamp || Date.now(),
              // Read state is local — the server does not track it — so a sync
              // must never resurrect something already dismissed.
              read: existing ? existing.read : false,
              category: categorise(actionType),
              actionType,
              request: existing?.request ?? parseRequest(r),
              origin: "remote",
            };
          });

          /*
           * Server history is authoritative only over rows the server has. A
           * health-factor warning raised in this browser was never sent
           * anywhere, so a sync that returned `mapped` alone deleted it — which
           * is exactly what happened to every locally-raised notification within
           * 60 seconds of arriving.
           */
          const locals = prev.filter((p) => p.origin === "local");
          const merged = [...locals, ...mapped].sort(
            (a, b) => b.timestamp - a.timestamp,
          );

          if (isSync) {
            const added = mapped.some((m) => !prev.some((p) => p.id === m.id));
            const removed = prev.some(
              (p) => p.origin !== "local" && !mapped.some((m) => m.id === p.id),
            );
            if (!added && !removed) return prev;
          }
          return merged.slice(0, MAX_STORED);
        });
      } catch {
        /* offline or backend down — the local list is still shown */
      }
    };

    fetchHistory(false);
    const syncId = window.setInterval(() => fetchHistory(true), 60_000);

    const connect = () => {
      if (cancelled) return;
      const wsHost = host.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${wsHost}/ws/receiver`);
      } catch {
        return;
      }
      socket = ws;

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onmessage = (e) => {
        if (cancelled) return;
        try {
          handleSignal(JSON.parse(e.data));
        } catch {
          /* not JSON, or a shape we don't handle */
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        // Backoff, capped. The original reconnected on a flat 5s timer and
        // never cancelled, so a backend outage produced a growing pile of
        // sockets all retrying at once.
        attempt += 1;
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      window.clearInterval(syncId);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (socket) {
        // Drop onclose first, or closing here schedules a reconnect for a
        // subscription that is being torn down.
        socket.onclose = null;
        socket.close();
      }
    };
    // handleSignal is defined below and closes only over stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, commit]);

  /* ------------------------------------------------------------------ */
  /* Context value                                                      */
  /* ------------------------------------------------------------------ */

  const value = useMemo<NotificationsContextType>(
    () => ({
      notifications,
      unreadCount,
      markAsRead,
      markAllAsRead,
      deleteNotification,
      clearAll,
      resolveRequest,
      notifyLocal,
      panelOpen,
      focusedId,
      openPanel,
      closePanel,
    }),
    [
      notifications,
      unreadCount,
      markAsRead,
      markAllAsRead,
      deleteNotification,
      clearAll,
      resolveRequest,
      notifyLocal,
      panelOpen,
      focusedId,
      openPanel,
      closePanel,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

/**
 * Throws outside a provider rather than returning a null-object default.
 *
 * A silent default here would mean the bell renders a permanent zero and every
 * Approve button does nothing, with no error anywhere — the failure mode is a
 * feature that looks fine and silently drops permission asks.
 */
export function useNotifications(): NotificationsContextType {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    // Diagnostic aid: print a stack to help locate the caller in the browser
    // when an Invalid Hook Call occurs. Keep this lightweight for dev only.
    // eslint-disable-next-line no-console
    console.error(
      "useNotifications called outside NotificationsProvider",
      new Error().stack,
    );
    throw new Error(
      "useNotifications must be used within a NotificationsProvider",
    );
  }
  return ctx;
}
