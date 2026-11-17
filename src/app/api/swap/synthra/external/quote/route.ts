import { inspectSynthraExternalSwap } from "@/lib/swap/synthraServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server proxy for the narrow, read-only external Synthra execution check.
 * It returns a source transaction only when the quote is cross-chain, native,
 * and exactly one wallet-signed step; no provider key reaches the browser.
 */
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const result = await inspectSynthraExternalSwap({
      user: p.get("address") ?? "",
      sourceChainId: Number(p.get("sourceChainId")),
      destinationChainId: Number(p.get("destinationChainId")),
      tokenIn: {
        address: p.get("tokenIn") ?? "",
        decimals: Number(p.get("decimalsIn")),
      },
      tokenOut: {
        address: p.get("tokenOut") ?? "",
        decimals: Number(p.get("decimalsOut")),
      },
      amount: p.get("amountUnits") ?? "",
      slippageBps: Number(p.get("slippageBps")),
    });
    return result
      ? Response.json(result, { headers: { "cache-control": "no-store" } })
      : Response.json(
          { error: "No safe external Synthra execution step" },
          { status: 404, headers: { "cache-control": "no-store" } },
        );
  } catch {
    return Response.json(
      { error: "Synthra external route unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
