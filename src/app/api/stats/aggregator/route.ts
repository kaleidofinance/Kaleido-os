import { NextResponse } from "next/server";
import { readAggregatorStats } from "@/lib/stats/aggregator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/stats/aggregator — cumulative verified Kyber-routed launch metrics. */
export async function GET() {
  const stats = await readAggregatorStats();
  if (!stats) {
    return NextResponse.json(
      { error: "aggregator stats unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json(stats);
}
