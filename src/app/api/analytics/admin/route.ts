import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin/auth";
import { readAdminMetrics } from "@/lib/analytics/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/analytics/admin — ops metrics, gated by a wallet signature from the
 * ADMIN_WALLETS allowlist (see lib/admin/auth). Body: { address, signature, ts }.
 * Fails closed with the verdict's own status; only a verified admin gets data.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const verdict = verifyAdmin(body as Record<string, unknown>);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: verdict.status });
  }
  const metrics = await readAdminMetrics();
  return NextResponse.json(metrics);
}
