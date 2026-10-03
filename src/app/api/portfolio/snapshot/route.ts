import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";
import { walletValueUsd } from "@/lib/portfolio/snapshot";

/**
 * POST /api/portfolio/snapshot?wallet=0x… — record today's value for a wallet.
 * The value is computed HERE from the chain (lib/portfolio/snapshot), never read
 * from the request, so anyone may trigger it and nobody can forge it. One row per
 * wallet per UTC day; a row computed in the last hour is returned, not redone.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FRESH_MS = 60 * 60 * 1000;

export async function POST(req: Request) {
  if (!isAdminConfigured || !supabaseAdmin) return Response.json({ error: "unconfigured" }, { status: 503 });
  const wallet = (new URL(req.url).searchParams.get("wallet") ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return Response.json({ error: "bad wallet" }, { status: 400 });
  const day = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabaseAdmin
    .from("portfolio_snapshots")
    .select("value_usd, computed_at")
    .eq("wallet", wallet)
    .eq("day", day)
    .maybeSingle();
  if (existing && Date.now() - Date.parse(String(existing.computed_at)) < FRESH_MS)
    return Response.json({ day, valueUsd: Number(existing.value_usd), cached: true });

  let v: Awaited<ReturnType<typeof walletValueUsd>>;
  try {
    v = await walletValueUsd(wallet);
  } catch (e) {
    return Response.json({ error: `could not read balances: ${(e as Error).message}` }, { status: 502 });
  }
  const { error } = await supabaseAdmin.from("portfolio_snapshots").upsert(
    { wallet, day, value_usd: v.valueUsd, unpriced: v.unpriced, computed_at: new Date().toISOString() },
    { onConflict: "wallet,day" },
  );
  if (error) return Response.json({ error: "could not store snapshot" }, { status: 500 });
  return Response.json({ day, valueUsd: v.valueUsd, unpriced: v.unpriced });
}
