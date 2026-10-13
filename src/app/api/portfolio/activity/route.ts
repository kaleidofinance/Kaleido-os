import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";

/**
 * GET /api/portfolio/activity?wallet=0x… — the wallet's credited Kaleido
 * activity, newest first, for the Portfolio Activity tab.
 *
 * Reads `point_actions` (service role; the table is not anon-readable) and
 * returns ONLY kind, chain, hash and time. Deliberately not `usd_value` or
 * `points`: `?wallet=` proves nothing, and per-wallet USD or points would turn
 * this into the volume/standing oracle that /api/leaderboard/me's header explains
 * keeping closed. Kind + hash + time is what any block explorer already shows.
 *
 * Only real activity kinds; waitlist task credits are bookkeeping, not activity.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["swap", "checkin", "lend", "lp"];

export async function GET(req: Request) {
  if (!isAdminConfigured || !supabaseAdmin)
    return Response.json({ error: "unconfigured" }, { status: 503 });
  const wallet = (new URL(req.url).searchParams.get("wallet") ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet))
    return Response.json({ error: "bad wallet" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("point_actions")
    .select("source_slug, chain_id, tx_hash, occurred_at")
    .eq("wallet", wallet)
    .in("source_slug", KINDS)
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (error) return Response.json({ error: "Could not read activity" }, { status: 500 });

  const items = (data ?? []).map((r) => ({
    kind: String(r.source_slug),
    chainId: r.chain_id === null ? null : Number(r.chain_id),
    txHash: typeof r.tx_hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(r.tx_hash) ? r.tx_hash : null,
    at: String(r.occurred_at),
  }));
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
