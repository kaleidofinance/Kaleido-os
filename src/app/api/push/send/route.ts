import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { redactAmounts } from "@/lib/notifications/redact";

/**
 * Sends a web push to a wallet's registered browsers.
 *
 * WHY THIS IS BEHIND A SHARED SECRET.
 * An unauthenticated push-send endpoint is an open relay pointed at your users'
 * lock screens: anyone who learns the URL can write arbitrary text — including
 * "Kaleido: confirm your seed phrase at …" — to every device that ever enabled
 * notifications, with the app's own icon next to it. That is a phishing
 * primitive with the product's branding attached, which is strictly worse than
 * ordinary spam. The secret is compared with a constant-time equality over
 * hashes, so the comparison itself cannot be used to recover it a byte at a
 * time.
 *
 * Callers: our own server-side jobs, and (once wired) the AI engine that
 * currently only speaks over the /ws/receiver WebSocket. Nothing in the browser
 * may call this — the secret would have to ship in the bundle to do so, which
 * would defeat the entire guard.
 */

const SECRET = process.env.PUSH_SEND_SECRET;
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:support@kaleido.example";

const vapidReady = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
if (vapidReady) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC!, VAPID_PRIVATE!);
}

/**
 * Hash both sides first so timingSafeEqual gets equal-length buffers. Passing
 * unequal lengths makes it throw, and catching that throw would leak the
 * secret's length.
 */
function secretMatches(provided: string | null): boolean {
  if (!SECRET || !provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(SECRET).digest();
  return timingSafeEqual(a, b);
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  hide_amounts: boolean;
}

export async function POST(request: NextRequest) {
  if (!SECRET) {
    // Refuse rather than fall open. A misconfigured deployment that sends
    // unauthenticated pushes is worse than one that sends none.
    return NextResponse.json(
      { error: "PUSH_SEND_SECRET is not configured; sending is disabled." },
      { status: 503 },
    );
  }
  if (!secretMatches(request.headers.get("x-kaleido-push-secret"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!vapidReady) {
    return NextResponse.json(
      { error: "VAPID keys are not configured." },
      { status: 503 },
    );
  }
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Push storage is not configured." },
      { status: 503 },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const wallet =
    typeof payload.wallet === "string" ? payload.wallet.toLowerCase() : null;
  const title = typeof payload.title === "string" ? payload.title : "";
  const body = typeof payload.body === "string" ? payload.body : "";

  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }
  if (!wallet) {
    // No broadcast path. "Send to everyone" is one typo away from a mass
    // notification, and nothing in this product needs it — every action_type
    // the app sends is about one user's own position.
    return NextResponse.json(
      { error: "wallet is required; broadcast sending is not supported." },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth, hide_amounts")
    .eq("wallet", wallet);

  if (error) {
    console.error("[push/send] lookup failed:", error.message);
    return NextResponse.json(
      { error: "Could not load subscriptions." },
      { status: 500 },
    );
  }

  const subs = (data ?? []) as SubRow[];
  if (subs.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, reason: "no subscriptions" });
  }

  const id = typeof payload.id === "string" ? payload.id : "";
  const category =
    typeof payload.category === "string" ? payload.category : "system";
  const actionable = payload.actionable === true;

  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      const message = JSON.stringify({
        id,
        title,
        // Per-subscription, because the preference belongs to the device that
        // will render it on a lock screen, not to the sender.
        body: sub.hide_amounts ? redactAmounts(body) : body,
        category,
        actionable,
        url: `/trade?notif=${encodeURIComponent(id)}`,
      });

      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          message,
        );
        return "sent";
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 mean the browser threw the subscription away — the user
        // cleared site data, or the push service expired it. Reap it now;
        // otherwise every future send retries a dead endpoint forever.
        if (status === 404 || status === 410) {
          await supabaseAdmin!
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
          return "expired";
        }
        throw err;
      }
    }),
  );

  const sent = results.filter(
    (r) => r.status === "fulfilled" && r.value === "sent",
  ).length;
  const expired = results.filter(
    (r) => r.status === "fulfilled" && r.value === "expired",
  ).length;
  const failed = results.filter((r) => r.status === "rejected").length;

  if (failed > 0) {
    console.error(
      `[push/send] ${failed} of ${subs.length} sends failed for ${wallet}`,
    );
  }

  return NextResponse.json({ ok: true, sent, expired, failed });
}
