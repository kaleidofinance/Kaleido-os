import { NextRequest, NextResponse } from "next/server";
import { resolveKyberSwap } from "@/lib/swap/kyberswap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/swap/quote — the browser's path to a KyberSwap swap route.
 *
 * getKyberSwapExecution runs in the browser as well as on the server, and our
 * integrator fee is configured from server env (SWAP_FEE_RECEIVER / SWAP_FEE_BPS).
 * So the browser cannot call KyberSwap directly with the fee; it calls here, and
 * this route resolves the same way the server planner does — adding the fee and
 * client id server-side so neither reaches the bundle. Mirrors /api/bridge/quote.
 *
 * The fee is decided in resolveKyberSwap, not read from the request, so a caller
 * can neither drop our fee nor forge one. A miss returns 404, which the caller
 * reads as "no route" — the same as a direct server resolution returning null.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const chainId = Number(p.get("chainId"));
  const tokenIn = p.get("tokenIn");
  const tokenOut = p.get("tokenOut");
  const amountUnits = p.get("amountUnits");
  const address = p.get("address");
  const slippageBps = Number(p.get("slippageBps"));

  if (
    !Number.isFinite(chainId) ||
    !tokenIn ||
    !tokenOut ||
    !amountUnits ||
    !address ||
    !Number.isFinite(slippageBps)
  ) {
    return NextResponse.json({ error: "missing swap params" }, { status: 400 });
  }

  try {
    const exec = await resolveKyberSwap({
      chainId,
      tokenIn,
      tokenOut,
      amountUnits,
      address,
      slippageBps,
    });
    if (!exec) {
      return NextResponse.json({ error: "no route" }, { status: 404 });
    }
    return NextResponse.json(exec);
  } catch {
    return NextResponse.json(
      { error: "swap quote upstream unreachable" },
      { status: 502 },
    );
  }
}
