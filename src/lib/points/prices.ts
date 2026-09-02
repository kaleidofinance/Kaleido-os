/**
 * Server-side USD valuation.
 *
 * Written for the points system and still its primary consumer, but not
 * exclusive to it: `lib/ai/auditor.ts` values positions through `valueOf`, and
 * `api/market/overview/route.ts` values the lending book for /leaderboard's stat
 * strip. Deliberately shared — a headline TVL and a points balance disagreeing
 * about the price of ETH would be worse than either being wrong.
 *
 * Deliberately does NOT call the protocol's own `getUsdValue`. Two reasons:
 *
 * 1. The contracts are being rewritten and redeployed across six chains. A
 *    points indexer coupled to one Diamond address would need re-pointing on
 *    every deploy, and a season of accrued points would be at the mercy of a
 *    migration.
 * 2. `getUsdValue` reverts for any token without a registered Pyth feed. On the
 *    current deployment only ETH and USDC are registered, so it cannot price
 *    KLD at all — and KLD is the token people will be staking.
 *
 * Prices are keyed by SYMBOL, not address. The same asset has a different
 * address on every chain, but a dollar of USDC is a dollar of USDC wherever it
 * sits, so valuation is chain-independent by construction.
 *
 * Server-only: this hits an external HTTP API and is never bundled for the
 * browser.
 */

import { feedFor } from "@/lib/v2/prices/feeds";

if (typeof window !== "undefined") {
  throw new Error(
    "[points/prices] server-only module imported in the browser. Points " +
      "valuation must never run client-side — a client-supplied price is a " +
      "client-supplied point balance.",
  );
}

/**
 * Pyth Hermes price feed IDs, verified against the live API.
 *
 * Exported because these ids are also the keys `AggregatorPriceOracle` registers
 * feeds under, so `lib/keeper/pushFeeds.ts` resolves an aggregator by asking
 * `feedAggregator(id)` with one of them. A second copy of the table there is a
 * copy that can be typed wrong, and a wrong id would publish one asset's price to
 * another asset's feed — on a feed the protocol liquidates on.
 */
export const PYTH_FEEDS: Record<string, string> = {
  ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  WETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  USDC: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  USDT: "2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
  BNB: "2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
};

/**
 * Protocol stablecoins with no independent feed, valued at par.
 *
 * This is an assumption, not a measurement: if one of these depegs, points
 * keep accruing as though it had not. Attach a real feed here the moment one
 * exists. Deliberately explicit so the assumption is visible rather than
 * buried in a fallback.
 */
const ASSUMED_PAR: Record<string, number> = {
  USDR: 1,
  kfUSD: 1,
  kafUSD: 1,
};

/**
 * Tokens with no price at all. KLD has no market price before TGE — that is
 * the whole point of a pre-TGE program — so anything denominated in it accrues
 * in raw token-units × time instead of USD × time.
 */
const UNPRICED = new Set(["KLD", "stKLD"]);

const HERMES = "https://hermes.pyth.network/api/latest_price_feeds";
const COINGECKO = "https://api.coingecko.com/api/v3/simple/price";
/**
 * Prices move slowly relative to a snapshot interval; one fetch serves a whole
 * run.
 *
 * Keyed per symbol, which matters now that there is more than one caller. This
 * used to cache the whole result map of the last fetch under a single global
 * slot, so a caller asking for ["USDC"] populated the cache, and a caller
 * asking for ["ETH", "USDC"] within the TTL got that same map back, found no
 * ETH entry in it, and was told ETH is `unpriced`. Nothing errored — the
 * lending book would simply have valued its ETH positions at nothing depending
 * on which caller warmed the cache first.
 *
 * `usd: null` is cached too, so a feed that is genuinely missing is not
 * re-fetched on every call.
 */
const TTL_MS = 60_000;
/* `via` is cached alongside the number so a fallback price is still reported as
   a fallback price for the whole TTL, rather than being read back as `pyth`
   because that is which branch the read-back happens to sit in. */
const cache = new Map<
  string,
  { at: number; usd: number | null; via: "pyth" | "coingecko" }
>();

export interface PriceResult {
  /** USD price, or null when the asset has no meaningful USD price. */
  usd: number | null;
  /** Where the number came from, so a snapshot can record its own provenance. */
  source: "pyth" | "coingecko" | "assumed-par" | "unpriced";
}

interface HermesFeed {
  id: string;
  price: { price: string; expo: number; publish_time: number };
}

async function fetchPyth(symbols: string[]): Promise<Map<string, number>> {
  const wanted = symbols.filter((s) => PYTH_FEEDS[s]);
  if (wanted.length === 0) return new Map();

  // Several symbols can share a feed (ETH and WETH), so de-duplicate before
  // asking Hermes. Array.filter rather than a Set spread, to stay within the
  // repo's ES5 downlevel target.
  const ids = wanted
    .map((s) => PYTH_FEEDS[s])
    .filter((id, i, arr) => arr.indexOf(id) === i);
  const qs = ids.map((id) => `ids[]=0x${id}`).join("&");

  const res = await fetch(`${HERMES}?${qs}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    /* Bounded so a dead primary cannot hold every caller open before the
       fallback is reached. This had no timeout, which was survivable while Pyth
       was the only source and a stall was indistinguishable from a slow answer;
       with a fallback behind it, an unbounded wait is pure added latency on
       every cache miss on every surface. */
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Hermes ${res.status}`);

  const feeds = (await res.json()) as HermesFeed[];
  const byId = new Map<string, number>();

  for (const f of feeds) {
    // Pyth reports price as an integer with a signed exponent:
    // real = price × 10^expo. expo is normally -8.
    const value = Number(f.price.price) * Math.pow(10, f.price.expo);
    if (Number.isFinite(value) && value > 0)
      byId.set(f.id.toLowerCase(), value);
  }

  const out = new Map<string, number>();
  for (const s of wanted) {
    const v = byId.get(PYTH_FEEDS[s].toLowerCase());
    if (v !== undefined) out.set(s, v);
  }
  return out;
}

/**
 * The same five symbols from CoinGecko, for when Hermes will not serve them.
 *
 * Not a second opinion and not a blend — strictly a fallback, reached only after
 * Pyth has failed, so a healthy run's provenance is unchanged and still reads
 * `pyth`.
 *
 * It exists because the primary went away. Measured 2026-08-28:
 * `hermes.pyth.network` answers every request with `401 unauthorized` — both the
 * deprecated `/api/latest_price_feeds` this file calls and the current
 * `/v2/updates/price/latest`, answered from Pyth's own app tier rather than a
 * Cloudflare edge block, so it is an auth requirement rather than an outage and
 * it will not simply pass. With one source and no fallback that took down every
 * USD figure this module feeds: the agent's spend caps, /api/market/overview,
 * /api/prices/spot, the leaderboard and points accrual.
 *
 * `feedFor` is reused rather than a second symbol table written here, so nothing
 * a caller writes ever reaches an outbound URL — the same rule the chart route
 * and `getSpotPrice` follow. What is NOT reused is `getSpotPrice` itself, and
 * that is deliberate rather than an oversight: it aborts at 6 seconds because it
 * runs inside the agent loop with a user watching a spinner, which is the right
 * call there and the wrong one here. Measured 2026-08-28 from this machine,
 * CoinGecko answers in 1.4–3.9s and node's own fetch overhead pushes it over
 * that 6s ceiling often enough to matter — a points run or a TVL figure can
 * afford to wait, so this carries its own budget instead of failing on a
 * threshold tuned for a different caller.
 *
 * One batched request rather than one per symbol: `simple/price` takes
 * comma-separated ids, and the fallback is hot exactly when every caller is
 * retrying at once, which is the worst moment to spend five rate-limit tokens
 * where one would do.
 *
 * Coverage is total rather than partial, which is why this is worth doing: the
 * CoinGecko allowlist carries ETH, WETH, USDC, USDT and BNB, and those are
 * exactly the five keys in PYTH_FEEDS. A fallback that covered three of five
 * would leave the caps half-enforced, which is harder to reason about than
 * either extreme.
 */
async function fetchCoinGecko(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = new Map<string, string>();
  for (const s of symbols) {
    const feed = feedFor(s);
    if (feed) ids.set(s, feed);
  }
  if (ids.size === 0) return out;

  const unique = [...new Set(ids.values())];
  const apiKey = process.env.COINGECKO_API_KEY;
  const url = `${COINGECKO}?ids=${encodeURIComponent(unique.join(","))}&vs_currencies=usd`;

  /* Two attempts, because this is the last source there is.
   *
   * Not defensive padding: with the fallback in place a single transient is now
   * the difference between a spend cap that is checked and a step the auditor
   * refuses outright, and a refusal caused by one dropped connection is a worse
   * answer than a second attempt. Measured on this machine while wiring it up —
   * outbound HTTPS from node intermittently fails as `fetch failed` on the first
   * call and succeeds immediately after. Bounded at two so a genuinely dead
   * upstream still fails fast rather than doubling every caller's wait
   * indefinitely. */
  let json: Record<string, { usd?: unknown }> | null = null;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 2 && json === null; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          ...(apiKey ? { "x-cg-demo-api-key": apiKey } : {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      json = (await res.json()) as Record<string, { usd?: unknown }>;
    } catch (err) {
      lastErr = err as Error;
      if (attempt === 2) throw new Error(`CoinGecko: ${lastErr.message}`);
    }
  }
  if (json === null) throw new Error(`CoinGecko: ${lastErr?.message ?? "no response"}`);

  for (const [symbol, feed] of ids) {
    const usd = json?.[feed]?.usd;
    /* Same guard as `getSpotPrice`: upstream returns `{}` for an id it does not
       know, and a zero or a null would pass a truthiness check and then be
       measured against a spend cap as though it were a price. */
    if (typeof usd === "number" && Number.isFinite(usd) && usd > 0)
      out.set(symbol, usd);
  }
  return out;
}

/**
 * USD prices for a set of symbols.
 *
 * Never throws on a single missing asset — an unpriced token is a normal
 * condition, not an error. It does still throw if the price source itself is
 * unreachable, because silently scoring a whole run at zero would be worse
 * than failing the run — but "unreachable" now means BOTH sources failed, not
 * just Pyth.
 */
export async function getPrices(
  symbols: string[],
): Promise<Map<string, PriceResult>> {
  const out = new Map<string, PriceResult>();
  const needPyth: string[] = [];

  for (const raw of symbols) {
    const s = raw.trim();
    if (UNPRICED.has(s)) {
      out.set(s, { usd: null, source: "unpriced" });
    } else if (PYTH_FEEDS[s]) {
      needPyth.push(s);
    } else if (ASSUMED_PAR[s] !== undefined) {
      out.set(s, { usd: ASSUMED_PAR[s], source: "assumed-par" });
    } else {
      out.set(s, { usd: null, source: "unpriced" });
    }
  }

  if (needPyth.length > 0) {
    const now = Date.now();
    /* Fetch only what is missing or expired, then read every requested symbol
     * back out of the cache. A symbol the fetch did not return is cached as
     * null, so it reports `unpriced` without being re-requested each call. */
    const stale = needPyth.filter((s) => {
      const hit = cache.get(s);
      return !hit || now - hit.at >= TTL_MS;
    });

    if (stale.length > 0) {
      /* Pyth first, CoinGecko only if Pyth fails outright. `fetchPyth` throws on
         a non-ok status, so the catch is the whole fallback trigger; a Pyth
         response that simply omits a symbol is left alone, because that is a
         missing feed id in the table above rather than an outage, and quietly
         papering over it with a second source would hide the config error. */
      let fresh: Map<string, number>;
      let via: "pyth" | "coingecko" = "pyth";
      try {
        fresh = await fetchPyth(stale);
      } catch (pythErr) {
        via = "coingecko";
        fresh = await fetchCoinGecko(stale);
        if (fresh.size === 0)
          /* Both sources are down. Preserve the documented contract and throw,
             naming both failures — a caller that sees only the second one will
             go looking in the wrong place. */
          throw new Error(
            `no price source reachable: pyth: ${(pythErr as Error).message}; coingecko returned nothing for ${stale.join(", ")}`,
          );
        console.warn(
          `[points/prices] Pyth unavailable (${(pythErr as Error).message}) — served ${fresh.size}/${stale.length} symbol(s) from CoinGecko`,
        );
      }
      for (const s of stale)
        cache.set(s, { at: now, usd: fresh.get(s) ?? null, via });
    }

    for (const s of needPyth) {
      const hit = cache.get(s);
      const usd = hit?.usd ?? null;
      out.set(
        s,
        usd === null
          ? { usd: null, source: "unpriced" }
          : { usd, source: hit?.via ?? "pyth" },
      );
    }
  }

  return out;
}

export async function getPrice(symbol: string): Promise<PriceResult> {
  const m = await getPrices([symbol]);
  return m.get(symbol.trim()) ?? { usd: null, source: "unpriced" };
}

/**
 * USD value of a token amount.
 *
 * `amount` is a decimal string in whole units (not wei) — callers format with
 * the token's decimals before valuing, so this function never needs to know
 * them. Returns null when the asset has no USD price, which is the caller's
 * signal to accrue in raw units instead of dropping the position.
 */
export async function valueOf(
  symbol: string,
  amount: string | number,
): Promise<{ usd: number | null; source: PriceResult["source"] }> {
  const qty = typeof amount === "number" ? amount : parseFloat(amount);
  if (!Number.isFinite(qty) || qty < 0) return { usd: 0, source: "unpriced" };

  const { usd, source } = await getPrice(symbol);
  return { usd: usd === null ? null : usd * qty, source };
}

/** Symbols the valuation layer can price without falling back to raw units. */
export const PRICEABLE = [
  ...Object.keys(PYTH_FEEDS),
  ...Object.keys(ASSUMED_PAR),
];
