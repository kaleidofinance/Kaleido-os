import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/serverClient";

/**
 * Removes a stored subscription.
 *
 * Called *before* the browser tears the subscription down, because once
 * `PushSubscription.unsubscribe()` resolves the endpoint is gone and there is
 * nothing left to key the delete on. Dead endpoints that linger get 410 Gone
 * from the push service on every send, which is how a subscriptions table turns
 * into a graveyard that slows every broadcast.
 */
export async function POST(request: NextRequest) {
  try {
    const { endpoint } = await request.json();
    if (typeof endpoint !== "string" || !endpoint) {
      return NextResponse.json(
        { error: "endpoint is required." },
        { status: 400 },
      );
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ ok: true, removed: false });
    }

    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint);

    if (error) {
      console.error("[push/unsubscribe] delete failed:", error.message);
      return NextResponse.json(
        { error: "Could not remove subscription." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, removed: true });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }
}
