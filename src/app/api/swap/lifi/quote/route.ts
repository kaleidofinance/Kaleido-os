import { NextRequest, NextResponse } from "next/server";
import { resolveLifiSwap } from "@/lib/swap/lifi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const exec = await resolveLifiSwap({
      chainId,
      tokenIn,
      tokenOut,
      amountUnits,
      address,
      slippageBps,
    });
    return exec
      ? NextResponse.json(exec)
      : NextResponse.json({ error: "no route" }, { status: 404 });
  } catch {
    return NextResponse.json(
      { error: "swap quote upstream unreachable" },
      { status: 502 },
    );
  }
}
