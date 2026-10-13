import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isAddress = (a: unknown): a is string =>
  typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

/**
 * GET /api/x/for-wallet?address=0x… — the X handle bound to a wallet.
 *
 * The wallet↔X binding is wallet-scoped (api/waitlist/x writes it, signature-
 * gated, one X per wallet). Waitlist members are mirrored into the standalone
 * wallet_x_links table, while non-waitlisters can link without creating a
 * waitlist row or receiving waitlist points.
 *
 * Read-only and public: `x_handle` is a public handle, the row carries no token.
 * A wallet with no row, or one that never linked, reads as `{ linked: false }`.
 * Reading only — binding stays on the signature-gated api/waitlist/x path.
 */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!isAddress(address)) return Response.json({ linked: false, handle: null });
  if (!isAdminConfigured || !supabaseAdmin)
    return Response.json({ linked: false, handle: null });

  const { data: link } = await supabaseAdmin
    .from("wallet_x_links")
    .select("x_handle")
    .eq("wallet", address.toLowerCase())
    .maybeSingle();
  if (link?.x_handle) return Response.json({ linked: true, handle: link.x_handle });

  // Compatibility for rows created before wallet_x_links was introduced.
  const { data } = await supabaseAdmin
    .from("waitlist")
    .select("x_handle, x_linked_at")
    .eq("wallet", address.toLowerCase())
    .maybeSingle();

  const linked = Boolean(data?.x_linked_at && data?.x_handle);
  return Response.json({ linked, handle: linked ? data!.x_handle : null });
}
