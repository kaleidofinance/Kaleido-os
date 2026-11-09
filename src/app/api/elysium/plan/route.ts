import { resolveElysiumTrade } from "@/lib/elysium/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Build a signable 0x AllowanceHolder -> Settler transaction for any token
 * launched across the 12 Elysium Launchpads on chain 99901.
 */
export async function POST(req: Request) {
  let body: {
    tokenIn?: string;
    tokenOut?: string;
    amountUnits?: string;
    amountInRaw?: string;
    address?: string;
    userAddress?: string;
    slippageBps?: number;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }

  const tokenIn = body.tokenIn;
  const tokenOut = body.tokenOut;
  const amountUnits = body.amountUnits ?? body.amountInRaw;
  const address = body.address ?? body.userAddress;
  const slippageBps = Number(body.slippageBps ?? 200);

  if (!tokenIn || !tokenOut || !amountUnits || !address) {
    return Response.json(
      { error: "tokenIn, tokenOut, amountUnits and address are required" },
      { status: 400 },
    );
  }

  const exec = await resolveElysiumTrade({
    tokenIn,
    tokenOut,
    amountUnits,
    address,
    slippageBps,
  });

  if (!exec) {
    return Response.json({
      elysium: false,
      reason: "not an active Elysium launchpad route",
    });
  }

  return Response.json({
    elysium: true,
    ...exec,
  });
}
