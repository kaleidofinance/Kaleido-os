import { NextRequest, NextResponse } from "next/server";
import { probeMainnetAcceptance } from "@/lib/ai/probeAcceptance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const rawTimeout = request.nextUrl.searchParams.get("timeout");
    const timeout = rawTimeout
      ? Math.min(10000, Math.max(1000, Number(rawTimeout)))
      : 5000;
    const report = await probeMainnetAcceptance(undefined, timeout);

    return NextResponse.json({
      ok: report.summary.rpcPassRate > 0,
      report,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
