import { NextResponse } from "next/server";
import { readExternalPools } from "@/lib/market/externalPools";

// The inventory is checked in and refreshed deliberately, not by each request.
export const revalidate = 3600;

export async function GET() {
  const data = (
    await Promise.all([
      readExternalPools(5042),
      readExternalPools(4663),
      readExternalPools(56),
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
