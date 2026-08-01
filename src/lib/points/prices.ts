/**
 * Server-side USD valuation for the points system.
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

if (typeof window !== "undefined") {
  throw new Error(
    "[points/prices] server-only module imported in the browser. Points " +
      "valuation must never run client-side — a client-supplied price is a " +
      "client-supplied point balance.",
  );
}

/** Pyth Hermes price feed IDs, verified against the live API. */
const PYTH_FEEDS: Record<string, string> = {
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

/** Prices move slowly relative to a snapshot interval; one fetch serves a whole run. */
const TTL_MS = 60_000;
let cache: { at: number; prices: Map<string, number> } | null = null;

export interface PriceResult {
  /** USD price, or null when the asset has no meaningful USD price. */
  usd: number | null;
  /** Where the number came from, so a snapshot can record its own provenance. */
  source: "pyth" | "assumed-par" | "unpriced";
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
  });
  if (!res.ok) throw new Error(`Hermes ${res.status}`);

  const feeds = (await res.json()) as HermesFeed[];
  const byId = new Map<string, number>();

  for (const f of feeds) {
    // Pyth reports price as an integer with a signed exponent:
    // real = price × 10^expo. expo is normally -8.
    const value = Number(f.price.price) * Math.pow(10, f.price.expo);
    if (Number.isFinite(value) && value > 0) byId.set(f.id.toLowerCase(), value);
  }

  const out = new Map<string, number>();
  for (const s of wanted) {
    const v = byId.get(PYTH_FEEDS[s].toLowerCase());
    if (v !== undefined) out.set(s, v);
  }
  return out;
}

/**
 * USD prices for a set of symbols.
 *
 * Never throws on a single missing asset — an unpriced token is a normal
 * condition, not an error. It does throw if the price source itself is
 * unreachable, because silently scoring a whole run at zero would be worse
 * than failing the run.
 */
export async function getPrices(symbols: string[]): Promise<Map<string, PriceResult>> {
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
    const fresh = cache && Date.now() - cache.at < TTL_MS ? cache.prices : null;
    const prices = fresh ?? (await fetchPyth(needPyth));
    if (!fresh) cache = { at: Date.now(), prices };

    for (const s of needPyth) {
      const v = prices.get(s);
      out.set(
        s,
        v === undefined
          ? { usd: null, source: "unpriced" }
          : { usd: v, source: "pyth" },
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
export const PRICEABLE = [...Object.keys(PYTH_FEEDS), ...Object.keys(ASSUMED_PAR)];
