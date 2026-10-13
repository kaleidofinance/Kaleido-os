import { NextRequest, NextResponse } from "next/server";
import { dexTokenPrices, type DexPriceToken } from "@/lib/swap/dexPrices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/prices/dex?chainId=5042&tokens=<addr>:<dec>,<addr>:<dec>
 *
 * USD prices for tokens the majors feeds (Pyth/CoinGecko) don't carry — Arc's
 * ecosystem — quoted from the KyberSwap aggregator server-side (see dexPrices.ts
 * for why). The portfolio calls this for holdings that came back unpriced from
 * the spot feed, so a wallet of EURC/cirBTC/meme tokens reads a dollar value
 * instead of a dash. A token that doesn't route is simply absent from the map,
 * the same wire contract the spot route uses.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const chainId = Number(p.get("chainId"));
  const raw = p.get("tokens") ?? "";

  if (!Number.isFinite(chainId) || !raw) {
    return NextResponse.json({ prices: {} });
  }

  const tokens: DexPriceToken[] = [];
  for (const part of raw.split(",")) {
    const [address, dec] = part.split(":");
    const decimals = Number(dec);
    if (address && Number.isInteger(decimals) && decimals >= 0) {
      tokens.push({ address, decimals });
    }
  }
  /* A cap, so a crafted URL can't fan out into hundreds of aggregator calls. A
     wallet has far fewer ecosystem tokens than this. */
  if (tokens.length === 0 || tokens.length > 50) {
    return NextResponse.json({ prices: {} });
  }

  try {
    const prices = await dexTokenPrices(chainId, tokens);
    return NextResponse.json({ prices });
  } catch {
    return NextResponse.json({ prices: {} });
  }
}
