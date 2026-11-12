import { NextResponse } from "next/server";
import { externalPoolRegistryStatus } from "@/lib/market/externalPools";

export const dynamic = "force-dynamic";

/** Monitoring endpoint for the checked-in external-pool registry. */
export async function GET() {
  const registry = externalPoolRegistryStatus();
  const body = {
    status: registry.refreshDue ? "stale" : "fresh",
    ...registry,
  };
  return NextResponse.json(body, {
    status: registry.refreshDue ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
