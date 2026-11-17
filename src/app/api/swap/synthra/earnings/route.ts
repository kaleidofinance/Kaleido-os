import { requestSynthraIntegratorStats } from "@/lib/swap/synthraServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-only read of the project's Synthra/SynRoute earnings envelope. */
export async function GET(request: Request) {
  const rawDays = new URL(request.url).searchParams.get("days");
  const days = rawDays == null ? undefined : Number(rawDays);
  try {
    const stats = await requestSynthraIntegratorStats(days);
    return stats
      ? Response.json(stats, { headers: { "cache-control": "no-store" } })
      : Response.json(
          { error: "Synthra earnings unavailable" },
          { status: 404, headers: { "cache-control": "no-store" } },
        );
  } catch {
    return Response.json(
      { error: "Synthra earnings unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
