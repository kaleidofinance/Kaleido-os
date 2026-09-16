import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isAddress = (a: unknown): a is string =>
  typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

/**
 * GET /api/x/for-wallet?address=0x… — the X handle bound to a wallet.
 *
 * The wallet↔X binding is the `waitlist` table's (api/waitlist/x writes it,
 * signature-gated, one X per wallet). The main-app LinkX reads THIS, keyed by the
 * CONNECTED wallet, rather than the raw `twitter_user` cookie — so the link is a
 * fact about the wallet, not the browser session: disconnect the wallet and the
 * handle clears, reconnect the same wallet and it returns. That is the whole point
 * of the fix; the cookie-only read showed a handle with no wallet connected.
 *
 * Read-only and public: `x_handle` is a public handle, the row carries no token.
 * A wallet with no row, or one that never linked, reads as `{ linked: false }`.
 * Reading only — the waitlist table cannot be written to from here (a new row
 * needs a ref_code and would mint welcome points, the sybil vector 20260914010000
 * guards); binding stays on the signature-gated api/waitlist/x path.
 */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!isAddress(address)) return Response.json({ linked: false, handle: null });
  if (!isAdminConfigured || !supabaseAdmin)
    return Response.json({ linked: false, handle: null });

  const { data } = await supabaseAdmin
    .from("waitlist")
    .select("x_handle, x_linked_at")
    .eq("wallet", address.toLowerCase())
    .maybeSingle();

  const linked = Boolean(data?.x_linked_at && data?.x_handle);
  return Response.json({ linked, handle: linked ? data!.x_handle : null });
}
