import { getAddress } from "ethers";
import { resolveSynthraLaunchpadTrade } from "@/lib/synthraLaunchpad/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { synthraLaunchpad: false, reason: "bad body" },
      { status: 400 },
    );
  }
  const chainId = Number(body.chainId);
  const tokenIn = String(body.tokenIn ?? "");
  const tokenOut = String(body.tokenOut ?? "");
  const amountUnits = String(body.amountUnits ?? "");
  const address = String(body.address ?? "");
  const slippageBps = Number(body.slippageBps ?? 200);
  try {
    getAddress(address);
  } catch {
    return Response.json(
      { synthraLaunchpad: false, reason: "invalid wallet address" },
      { status: 400 },
    );
  }
  try {
    const result = await resolveSynthraLaunchpadTrade({
      chainId,
      tokenIn,
      tokenOut,
      amountUnits,
      address,
      slippageBps,
    });
    return Response.json(
      result
        ? { synthraLaunchpad: true, ...result }
        : { synthraLaunchpad: false, reason: "not an active Synthra launch" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        synthraLaunchpad: false,
        reason: "Synthra Launchpad quote unavailable",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
