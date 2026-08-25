"use client";

/**
 * Web push — the rung of the ladder that still works when the browser is shut.
 *
 * A page-level `new Notification(...)` dies with the page, so everything in
 * deliver.ts stops at "tab is open somewhere". Reaching a closed browser needs a
 * service worker, because the worker is what the OS wakes up to handle a push
 * event when no tab exists. That is the whole reason public/sw.js is in the tree.
 *
 * Chrome mandates `userVisibleOnly: true`: a subscription that could receive
 * silent pushes would be a tracking channel, so the browser requires that every
 * push show a notification. The worker honours that unconditionally.
 *
 * iOS is the awkward one — Safari only delivers web push to a site the user has
 * added to their Home Screen, which is why public/manifest.webmanifest exists
 * and is linked from the root layout. Without the manifest, `subscribe()` throws
 * on iOS and nothing explains why.
 */

import { getPrefs } from "./deliver";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    Boolean(VAPID_PUBLIC)
  );
}

/**
 * VAPID keys travel as base64url; `applicationServerKey` wants raw bytes.
 * The padding and the two substitutions are the whole difference between
 * base64url and base64, and getting them wrong yields an
 * "InvalidCharacterError" from atob that reads like a network problem.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator))
    return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Subscribes and hands the subscription to our own server to store.
 *
 * Must run from a user gesture: it needs Notification permission, and the same
 * gesture rules apply here as in deliver.ts.
 */
export async function subscribePush(address?: string): Promise<boolean> {
  if (!pushSupported() || !VAPID_PUBLIC) return false;
  try {
    const reg =
      (await registerWorker()) ?? (await navigator.serviceWorker.ready);
    if (!reg) return false;

    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          VAPID_PUBLIC,
        ) as BufferSource,
      }));

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // hideAmounts travels with the subscription because the server composes
      // the push payload and cannot read a localStorage preference on a device
      // whose browser is closed. Re-post this route to change it.
      body: JSON.stringify({
        address,
        subscription: sub.toJSON(),
        hideAmounts: getPrefs().hideAmounts,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function unsubscribePush(): Promise<boolean> {
  try {
    const sub = await currentSubscription();
    if (!sub) return true;
    // Tell the server before tearing the subscription down: once `unsubscribe()`
    // resolves, the endpoint is gone and there is nothing left to key the delete
    // on, which is how dead subscriptions accumulate server-side.
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    return await sub.unsubscribe();
  } catch {
    return false;
  }
}
