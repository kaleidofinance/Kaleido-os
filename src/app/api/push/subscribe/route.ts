import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/serverClient";

/**
 * Stores a browser's push subscription so the server can reach a user whose
 * browser is closed.
 *
 * Upsert on `endpoint` rather than insert: a browser hands back the same
 * endpoint every time it re-subscribes, and inserting would either fail on the
 * primary key or, worse, accumulate a row per page load and push the same user
 * five copies of every notification.
 *
 * The subscription's keys are a capability — see the migration comment — so this
 * route is the only writer and the table denies everything else.
 */
export async function POST(request: NextRequest) {
  try {
    const { address, subscription, hideAmounts } = await request.json();

    const endpoint: unknown = subscription?.endpoint;
    const p256dh: unknown = subscription?.keys?.p256dh;
    const auth: unknown = subscription?.keys?.auth;

    if (
      typeof endpoint !== "string" ||
      typeof p256dh !== "string" ||
      typeof auth !== "string"
    ) {
      return NextResponse.json(
        {
          error:
            "A subscription with endpoint and keys.p256dh/auth is required.",
        },
        { status: 400 },
      );
    }

    if (!supabaseAdmin) {
      // Unconfigured Supabase disables push rather than 500ing, matching how
      // credits.ts degrades. Said plainly so a deployment knows why nothing
      // arrives instead of assuming the browser refused.
      return NextResponse.json(
        { ok: false, stored: false, reason: "push storage is not configured" },
        { status: 503 },
      );
    }

    const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
      {
        endpoint,
        wallet: typeof address === "string" ? address.toLowerCase() : null,
        p256dh,
        auth,
        // Default true when the client says nothing. The safe default must not
        // depend on the caller remembering to ask for it.
        hide_amounts: hideAmounts !== false,
        user_agent: request.headers.get("user-agent"),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );

    if (error) {
      console.error("[push/subscribe] upsert failed:", error.message);
      return NextResponse.json(
        { error: "Could not store subscription." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, stored: true });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }
}
