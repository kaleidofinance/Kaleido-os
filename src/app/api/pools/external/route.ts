import { NextResponse } from "next/server";
import { readExternalPools } from "@/lib/market/externalPools";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = (await Promise.all([readExternalPools(5042), readExternalPools(4663)]))
    .filter((snapshot) => snapshot !== null);
  return NextResponse.json({ data }, {
    status: data.length ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
