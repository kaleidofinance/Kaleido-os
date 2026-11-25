import { NextResponse } from "next/server";
import { readExternalPools } from "@/lib/market/externalPools";
import { readSynthraPools } from "@/lib/market/synthraPools";

// The inventory is checked in and refreshed deliberately, not by each request.
export const revalidate = 3600;

export async function GET() {
  const data = (
    await Promise.all([
      readExternalPools(5042),
      readExternalPools(4663),
      readExternalPools(56),
      readExternalPools(8453),
      readExternalPools(99901),
      readSynthraPools(4663),
      readSynthraPools(5042),
      readSynthraPools(99901),
    ])
  ).filter((snapshot) => snapshot !== null);
  return NextResponse.json(
    { data },
    {
      status: data.length ? 200 : 503,
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    },
  );
}
