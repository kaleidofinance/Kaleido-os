import { PRICED_SYMBOLS, feedFor } from "./feeds";

/**
 * The current USD price of one asset.
 *
 * Split from `/api/prices` rather than folded into it because the two answer
 * different questions from different endpoints: that route serves a *series*
 * for the chart from `market_chart`, this one serves a *scalar* from
 * `simple/price`. Asking the series endpoint for a spot price means fetching a
 * day of closes to read the last element — a hundred times the payload for one
 * number, and a number that is the last close rather than the current price.
 *
 * The allowlist is shared, and that is the part that matters. A symbol arriving
 * from a model is exactly as untrusted as one arriving from a browser: it is
 * resolved through `feedFor` or the request is refused, so nothing a caller
 * writes is ever interpolated into an outbound URL. Same rule as the chart
 * route, same reason.
 *
 * Server-side only in practice — Luca's read tools are the caller — but there is
 * nothing browser-hostile here, and no key is read, so it is not enforced.
 */

const UPSTREAM = "https://api.coingecko.com/api/v3/simple/price";

/**
 * One minute, matching the chart's shortest range. A spot price is the most
 * volatile thing this file serves, so the TTL is the floor rather than a
 * compromise: it exists to stop a conversation that mentions ETH four times
 * from spending four rate-limit tokens, not to make the number stale.
 */
const TTL = 60_000;

/** Bounded so a long-lived instance cannot grow one entry per symbol forever. */
const MAX_KEYS = 32;

export interface SpotPrice {
  /** The symbol as asked for, uppercased. */
  symbol: string;
  usd: number;
  /** 24h move in percent, or null when upstream omitted it. */
  change24hPct: number | null;
  /** When this was fetched, epoch ms. Not when upstream last traded. */
  asOf: number;
}

interface Cached {
  at: number;
  body: SpotPrice;
}

const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<SpotPrice>>();

function remember(key: string, body: SpotPrice, now: number) {
  if (cache.size >= MAX_KEYS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: now, body });
}

async function fetchSpot(
  symbol: string,
  feed: string,
  now: number,
): Promise<SpotPrice> {
  const url =
    `${UPSTREAM}?ids=${encodeURIComponent(feed)}` +
    `&vs_currencies=usd&include_24hr_change=true`;

  const apiKey = process.env.COINGECKO_API_KEY;
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      ...(apiKey ? { "x-cg-demo-api-key": apiKey } : {}),
    },
    cache: "no-store",
    /*
     * Deliberately short. This runs inside the agent loop, where the caller is a
     * user watching a spinner and the loop may make several more provider round
     * trips after this returns. A read that takes longer than this is worth
     * failing so the model can say "I could not get it" while the turn is still
     * worth waiting for.
     */
    signal: AbortSignal.timeout(6_000),
  });

  if (!res.ok) throw new Error(`upstream ${res.status}`);

  const json: unknown = await res.json();
  const entry = (json as Record<string, unknown>)?.[feed];
  const usd = (entry as { usd?: unknown })?.usd;
  const change = (entry as { usd_24h_change?: unknown })?.usd_24h_change;

  /*
   * A price must be a finite positive number or it is not a price. Upstream
   * returns `{}` for an id it does not know, and a zero or a null would sail
   * through a truthiness check and get quoted to a user as fact.
   */
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
    throw new Error("upstream shape");
  }

  return {
    symbol,
    usd,
    change24hPct:
      typeof change === "number" && Number.isFinite(change)
        ? Number(change.toFixed(2))
        : null,
    asOf: now,
  };
}

/**
 * Spot price for a symbol, or null when we carry no feed for it.
 *
 * Null is the "not priced" answer and is distinct from a throw, which means the
 * lookup was attempted and failed. Callers have to tell those apart: the first
 * is answerable ("I do not price that asset"), the second is not.
 */
export async function getSpotPrice(
  symbol: string | null | undefined,
): Promise<SpotPrice | null> {
  const feed = feedFor(symbol);
  if (!feed) return null;

  const canonical = String(symbol).trim().toUpperCase();
  const now = Date.now();

  const fresh = cache.get(feed);
  if (fresh && now - fresh.at < TTL) {
    // Keyed by feed, so WETH and ETH share an entry. Echo back the symbol that
    // was actually asked for rather than whichever one warmed the cache.
    return { ...fresh.body, symbol: canonical };
  }

  let pending = inflight.get(feed);
  if (!pending) {
    pending = fetchSpot(canonical, feed, now).finally(() => {
      inflight.delete(feed);
    });
    inflight.set(feed, pending);
  }

  try {
    const body = await pending;
    remember(feed, body, now);
    return { ...body, symbol: canonical };
  } catch (err) {
    /*
     * Stale beats nothing, but only with the age attached. A price is a claim
     * about now, so handing back an hour-old number silently is the one failure
     * this file could cause that a user would act on. `asOf` stays at the
     * original fetch time and the caller decides whether to quote it.
     */
    if (fresh) return { ...fresh.body, symbol: canonical };
    throw err;
  }
}

/** Symbols this module can price, for error messages. */
export { PRICED_SYMBOLS };
