import { NextRequest, NextResponse } from "next/server";
import { readTimeseries } from "@/lib/analytics/timeseries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/analytics/timeseries?days=30 — daily volume, fees, swaps and new
 * wallets for the public charts. `days` is clamped 1..365. Public: no per-wallet
 * or ops data, same as the overview.
 */
export async function GET(request: NextRequest) {
  const raw = Number(request.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(raw) ? Math.max(1, Math.min(365, Math.floor(raw))) : 30;
  const series = await readTimeseries(days);
  return NextResponse.json({ days, series });
}
