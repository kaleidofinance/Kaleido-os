import { runReadTool } from "@/lib/ai/readTools";

/**
 * GET /api/lookup/balances?address=0x…&chainId=5042 — any wallet's token balances
 * on one chain, for Luca's local "check the balance of 0x…" answer. The same
 * getBalances read the model's tool runs (registry tokens, multicall, unread ≠
 * zero), so the local answer and the model's cannot disagree. Public chain data;
 * no wallet signature needed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const address = (q.get("address") ?? "").trim();
  const chainId = Number(q.get("chainId") ?? "5042");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address))
    return Response.json({ error: "bad address" }, { status: 400 });
  if (!Number.isInteger(chainId) || chainId <= 0)
    return Response.json({ error: "bad chainId" }, { status: 400 });
  const out = await runReadTool("getBalances", { address }, chainId);
  return Response.json(out, { headers: { "Cache-Control": "no-store" } });
}
