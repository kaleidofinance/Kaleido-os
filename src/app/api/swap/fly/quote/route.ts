import { resolveFlyTrade } from "@/lib/swap/flytrade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainId = Number(url.searchParams.get("chainId"));
  const tokenIn = url.searchParams.get("tokenIn") ?? "";
  const tokenOut = url.searchParams.get("tokenOut") ?? "";
  const amountUnits = url.searchParams.get("amountUnits") ?? "";
  const address = url.searchParams.get("address") ?? "";
  const slippageBps = Number(url.searchParams.get("slippageBps") ?? 50);
  if (!Number.isInteger(chainId) || !tokenIn || !tokenOut || !amountUnits || !address)
    return Response.json({ error: "invalid swap quote request" }, { status: 400 });
  const result = await resolveFlyTrade({ chainId, tokenIn, tokenOut, amountUnits, address, slippageBps });
  return result ? Response.json(result) : Response.json({ error: "no Fly route" }, { status: 404 });
}
