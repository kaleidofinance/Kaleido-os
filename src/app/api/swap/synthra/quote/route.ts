import { getSynthraExecution } from "@/lib/swap/synthra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const result = await getSynthraExecution({
      chainId: Number(p.get("chainId")),
      tokenIn: p.get("tokenIn") ?? "",
      tokenOut: p.get("tokenOut") ?? "",
      decimalsIn: Number(p.get("decimalsIn")),
      decimalsOut: Number(p.get("decimalsOut")),
      amountUnits: p.get("amountUnits") ?? "",
      address: p.get("address") ?? "",
      slippageBps: Number(p.get("slippageBps")),
    });
    return result
      ? Response.json(result, { headers: { "cache-control": "no-store" } })
      : Response.json({ error: "No eligible Synthra route" }, { status: 404 });
  } catch {
    return Response.json(
      { error: "Synthra route unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
