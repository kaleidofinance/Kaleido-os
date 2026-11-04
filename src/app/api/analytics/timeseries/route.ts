import { NextRequest, NextResponse } from "next/server";
import { readTimeseries } from "@/lib/analytics/timeseries";
import { analyticsChain } from "@/lib/analytics/scope";

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
  let chainId: number | undefined;
  try { chainId = analyticsChain(request.nextUrl.searchParams.get("chain")); }
  catch { return NextResponse.json({ error: "Unsupported analytics network" }, { status: 400 }); }
  const series = await readTimeseries(days, chainId);
  return NextResponse.json({ days, series });
}
