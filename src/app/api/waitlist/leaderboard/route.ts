import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";

/**
 * Top referrers on the Arc waitlist. Rank + referral count + a shortened wallet,
 * read from the waitlist_leaderboard view through the service-role client (the
 * raw table has no public policy). Public, cacheable briefly.
 */
export const runtime = "nodejs";

const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

export async function GET() {
  if (!isAdminConfigured || !supabaseAdmin)
    return Response.json({ leaders: [] }, { status: 503 });

  const { data, error } = await supabaseAdmin
    .from("waitlist_leaderboard")
    .select("wallet, referrals, rank")
    .order("rank", { ascending: true })
    .limit(50);

  if (error) return Response.json({ leaders: [] }, { status: 500 });

  const leaders = (data ?? [])
    .filter((r) => Number(r.referrals) > 0)
    .map((r) => ({
      rank: r.rank,
      wallet: short(String(r.wallet)),
      referrals: Number(r.referrals),
    }));

  return Response.json(
    { leaders },
    { headers: { "cache-control": "public, max-age=30" } },
  );
}
