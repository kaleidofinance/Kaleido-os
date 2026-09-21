import { NextResponse } from "next/server";
import { readPlatformTotals } from "@/lib/stats/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/stats/platform — cumulative platform-wide volume and fees, summed
 * across Kaleido's products (routed swaps + CCTP bridges). 503 only when every
 * underlying source is unavailable; see lib/stats/platform.ts for what is
 * counted and what is not yet indexed.
 */
export async function GET() {
  const totals = await readPlatformTotals();
  if (!totals) {
    return NextResponse.json(
      { error: "platform stats unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json(totals);
}
