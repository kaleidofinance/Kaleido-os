import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";

/**
 * GET /api/portfolio/history?wallet=0x… — the wallet's daily snapshots (last
 * 366 days), oldest first, for the balance chart. Wallet token value only, as
 * computed by /api/portfolio/snapshot.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAdminConfigured || !supabaseAdmin) return Response.json({ points: [] });
  const wallet = (new URL(req.url).searchParams.get("wallet") ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return Response.json({ error: "bad wallet" }, { status: 400 });
  const since = new Date(Date.now() - 366 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("portfolio_snapshots")
    .select("day, value_usd")
    .eq("wallet", wallet)
    .gte("day", since)
    .order("day", { ascending: true });
  if (error) return Response.json({ error: "could not read history" }, { status: 500 });
  const points = (data ?? []).map((r) => [Date.parse(`${r.day}T12:00:00Z`), Number(r.value_usd)] as [number, number]);
  return Response.json({ points }, { headers: { "Cache-Control": "no-store" } });
}
