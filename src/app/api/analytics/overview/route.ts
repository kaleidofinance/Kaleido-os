import { NextResponse } from "next/server";
import { readAnalyticsOverview } from "@/lib/analytics/overview";
import { analyticsChain } from "@/lib/analytics/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/analytics/overview — public headline KPIs across every Kaleido
 * product (trading, growth, Luca, points). Each domain is independent and may be
 * null when its source is unavailable; the page renders what exists. No secret
 * or sensitive per-wallet data here — that belongs to the admin section (P3).
 */
export async function GET(request: Request) {
  let chainId: number | undefined;
  try { chainId = analyticsChain(new URL(request.url).searchParams.get("chain")); }
  catch { return NextResponse.json({ error: "Unsupported analytics network" }, { status: 400 }); }
  const overview = await readAnalyticsOverview(chainId);
  return NextResponse.json(overview);
}
