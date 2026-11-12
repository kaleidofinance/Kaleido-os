import { NextResponse } from "next/server";
import { chainTokenByAddress } from "@/constants/tokens";
import { buildExternalPoolRefreshReport } from "@/lib/market/externalPoolReport";
import { EXTERNAL_POOL_SCAN_PAIRS } from "@/lib/market/externalPoolScanPairs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const expected = process.env.EXTERNAL_POOL_REFRESH_SECRET?.trim();
  if (!expected) return false;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(actual && actual === expected);
}

/**
 * Run the review scan without mutating the checked-in registry. A human reviews
 * the JSON report and promotes only approved entries in a normal commit.
 */
export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json(
      { error: "External pool refresh is not armed." },
      { status: 401 },
    );
  }
  const report = await buildExternalPoolRefreshReport(EXTERNAL_POOL_SCAN_PAIRS, {
    clientId: process.env.KYBER_CLIENT_ID,
    isKnownToken: (chainId, address) => Boolean(chainTokenByAddress(chainId, address)),
  });
  return NextResponse.json(report, {
    status: report.routeObservations > 0 ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
