import type { TokenFacts } from "@/lib/v2/cards/tokenCard";
import { resolveTokenFacts } from "@/lib/v2/cards/resolveTokenServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: TokenFacts, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawAddr = url.searchParams.get("address") ?? "";
  const chainId = Number(url.searchParams.get("chainId"));
  const { status, facts } = await resolveTokenFacts(chainId, rawAddr);
  return json(facts, status);
}
