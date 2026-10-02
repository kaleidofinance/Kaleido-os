import { loadRate, loadCampaignMultiplier } from "@/lib/points/credit";

/**
 * GET /api/pools/points — what providing liquidity earns in Season 1 points, for
 * the pool table's Points column.
 *
 * The same numbers the points-lp cron credits with (loadRate + the active `lp`
 * campaign), so the column cannot advertise a rate the cron does not pay. Applies
 * to in-range positions in Kaleido V3 pools on Arc mainnet (the cron's factory).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEASON = 1;
const CHAIN_ID = 5042;

export async function GET() {
  const base = await loadRate("lp", SEASON);
  if (!base) return Response.json({ active: false }, { headers: { "Cache-Control": "s-maxage=300" } });
  const boost = await loadCampaignMultiplier("lp", SEASON, new Date().toISOString());
  const perUsdPerDay = base.rate * base.multiplier * (boost > 1 ? boost : 1);
  return Response.json(
    { active: true, chainId: CHAIN_ID, baseRate: base.rate, boost: boost > 1 ? boost : 1, perUsdPerDay },
    { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } },
  );
}
