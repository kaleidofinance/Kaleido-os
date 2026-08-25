/*
 * Kaleido service worker — web push only.
 *
 * Deliberately not a caching/offline worker. Adding a fetch handler here would
 * put a cache in front of every request the app makes, and a stale-serving
 * worker in front of a trading app is a way to show someone last week's prices.
 * This worker exists for one reason: to be woken by the OS when a push arrives
 * and no tab is open.
 *
 * Two handlers, and both matter:
 *
 *   push              — Chrome subscribes with userVisibleOnly:true, so every
 *                       push MUST result in a visible notification. Failing to
 *                       show one gets the subscription revoked by the browser,
 *                       silently, and push simply stops working later.
 *   notificationclick — focus an existing tab rather than opening a second one.
 *                       Opening a fresh window when the app is already running
 *                       is the single most common web-push mistake.
 */

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every old tab to close;
  // otherwise a first-time subscriber has no active worker to receive a push.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Kaleido", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Kaleido";
  const id = payload.id || "";
  const actionable = payload.actionable === true;

  const options = {
    body: payload.body || "",
    icon: "/notifications.svg",
    badge: "/notifications.svg",
    // Same collapsing rule as the page-level path in deliver.ts: one live
    // notification per subject, updates replace rather than stack.
    tag: payload.tag || `kaleido:${payload.category || "system"}:${id}`,
    renotify: true,
    requireInteraction: actionable,
    data: { id, url: payload.url || `/trade?notif=${encodeURIComponent(id)}` },
    // An agent permission ask gets buttons on the toast itself — this is the
    // part that makes it feel like a desktop app rather than a web page.
    // "Review", not "Approve": approving a plan needs a wallet signature, and a
    // button that cannot do what it says is worse than one more click.
    actions: actionable
      ? [
          { action: "review", title: "Review" },
          { action: "dismiss", title: "Dismiss" },
        ]
      : [],
  };

  // waitUntil is not optional — without it the worker may be killed before the
  // notification is shown, which reads as "push works sometimes".
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const data = event.notification.data || {};
  const url = data.url || "/trade";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        // Reuse the running app: focus it and let the page open the panel in
        // place. Navigating an already-open tab would throw away whatever the
        // user had on screen.
        if ("focus" in client) {
          await client.focus();
          client.postMessage({
            type: "kaleido:open-notification",
            id: data.id,
          });
          return;
        }
      }

      // Nothing open — this is the browser-was-closed case.
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});
