import { NextResponse } from "next/server";
import { readExternalPools } from "@/lib/market/externalPools";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await readExternalPools(4663);
  return NextResponse.json({ data }, {
    status: data ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
