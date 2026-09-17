import { kyberSwapChainSlug } from "./kyberswap";

/**
 * USD prices for arbitrary tokens on a KyberSwap chain, from the aggregator.
 *
 * Pyth and CoinGecko price a handful of majors; Arc's ecosystem — EURC, cirBTC,
 * and every meme that trades there — is on neither. But it all trades on the
 * DEX, so a token's price simply IS what the aggregator quotes one of it for in
 * USDC. This asks exactly that: 1 token → USDC, and the output in dollars is the
 * price. Server-side because it is the same KyberSwap the swap proxy uses (one
 * cached call serves every browser, and no key or fee logic reaches the bundle).
 */

const KYBER_API = "https://aggregator-api.kyberswap.com";

/* The USDC leg we quote against, per chain — the token whose one unit is a
   dollar. On Arc that is the 0x3600 6-decimal ERC20 face of native USDC, the
   form the aggregator itself trades (see kyberswap.ts). */
const QUOTE_USDC: Record<number, { address: string; decimals: number }> = {
  5042: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
};

export interface DexPriceToken {
  address: string;
  decimals: number;
}

/* Per-token cache, so a token priced for one wallet is not re-quoted for the
   next. Keyed by chain slug + lowercased address; a null result is cached too,
   briefly, so an unroutable token does not re-hit the API on every request. */
const cache = new Map<string, { at: number; price: number | null }>();
const TTL_MS = 60_000;

async function priceOne(
  slug: string,
  usdc: { address: string; decimals: number },
  token: DexPriceToken,
): Promise<number | null> {
  const addr = token.address.toLowerCase();
  if (addr === usdc.address.toLowerCase()) return 1;

  const key = `${slug}:${addr}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.price;

  let price: number | null = null;
  try {
    const amountIn = (10n ** BigInt(token.decimals)).toString();
    const qs = new URLSearchParams({
      tokenIn: token.address,
      tokenOut: usdc.address,
      amountIn,
    });
    const res = await fetch(`${KYBER_API}/${slug}/api/v1/routes?${qs}`, {
      headers: { "x-client-id": "kaleido-prices" },
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as {
        data?: { routeSummary?: { amountOut?: string } };
      };
      const out = json.data?.routeSummary?.amountOut;
      if (out) {
        const usd = Number(out) / 10 ** usdc.decimals;
        if (Number.isFinite(usd) && usd > 0) price = usd;
      }
    }
  } catch {
    price = null;
  }

  cache.set(key, { at: Date.now(), price });
  return price;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (i < items.length) {
        const idx = i;
        i += 1;
        out[idx] = await fn(items[idx]);
      }
    })(),
  );
  await Promise.all(workers);
  return out;
}

/** USD price per token (lowercased address → dollars), from the DEX. */
export async function dexTokenPrices(
  chainId: number,
  tokens: DexPriceToken[],
): Promise<Record<string, number>> {
  const slug = kyberSwapChainSlug(chainId);
  const usdc = QUOTE_USDC[chainId];
  if (!slug || !usdc || tokens.length === 0) return {};

  const prices = await mapLimit(tokens, 5, (t) => priceOne(slug, usdc, t));
  const out: Record<string, number> = {};
  tokens.forEach((t, i) => {
    const p = prices[i];
    if (p !== null) out[t.address.toLowerCase()] = p;
  });
  return out;
}
