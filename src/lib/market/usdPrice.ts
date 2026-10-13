import type { IToken } from "@/constants/types/dex";
import { fetchSpotPricesSoon, priceLookup } from "./spot";

/**
 * One token's live USD price, for turning "$100 worth of X" into an amount of X
 * before the grammar parses it. Spot feed first (majors), then /api/prices/dex
 * (KyberSwap; on Arc it falls back to the token's Argus pool), each bounded so a
 * slow price never stalls a send. Null when nothing prices it — the sentence then
 * goes to the model, which never guesses either.
 */
export async function fetchUsdPrice(
  token: IToken,
  chainId: number | undefined,
  ms = 4000,
): Promise<number | null> {
  const spot = priceLookup(await fetchSpotPricesSoon(ms))(token.symbol);
  if (spot !== null && spot > 0) return spot;
  if (!chainId || !/^0x[0-9a-fA-F]{40}$/.test(token.address)) return null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    const qs = new URLSearchParams({ chainId: String(chainId), tokens: `${token.address}:${token.decimals}` });
    const res = await fetch(`/api/prices/dex?${qs}`, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { prices?: Record<string, number> };
    const p = body.prices?.[token.address.toLowerCase()];
    return typeof p === "number" && Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}
