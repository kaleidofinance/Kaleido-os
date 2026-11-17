import { requestSynthraSwapStatus } from "@/lib/swap/synthraServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server proxy for Synthra's external execution status.  Synthra keys stay
 * server-side; the browser receives only the provider's status envelope.
 */
export async function GET(request: Request) {
  const requestId = new URL(request.url).searchParams.get("requestId") ?? "";
  try {
    const status = await requestSynthraSwapStatus(requestId);
    return status
      ? Response.json(status, { headers: { "cache-control": "no-store" } })
      : Response.json(
          { error: "Synthra execution status unavailable" },
          { status: 404, headers: { "cache-control": "no-store" } },
        );
  } catch {
    return Response.json(
      { error: "Synthra execution status unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
