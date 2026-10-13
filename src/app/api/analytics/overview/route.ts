import { NextResponse } from "next/server";
import { readAnalyticsOverview } from "@/lib/analytics/overview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/analytics/overview — public headline KPIs across every Kaleido
 * product (trading, growth, Luca, points). Each domain is independent and may be
 * null when its source is unavailable; the page renders what exists. No secret
 * or sensitive per-wallet data here — that belongs to the admin section (P3).
 */
export async function GET() {
  const overview = await readAnalyticsOverview();
  return NextResponse.json(overview);
}
