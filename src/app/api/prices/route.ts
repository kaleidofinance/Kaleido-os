import { NextResponse } from "next/server";
import {
  DEFAULT_RANGE,
  RANGE_SPECS,
  feedFor,
  isPriceRange,
  type PriceRange,
  type PriceSeriesResponse,
  type WirePoint,
} from "@/lib/v2/prices/feeds";

/**
 * Price history for the trade chart.
 *
 * A proxy rather than a direct call from the browser, for three reasons that
 * each matter on their own:
 *
 *   1. Rate limits are per-IP upstream. Called from the client, every user
 *      spends their own budget and a user with three tabs open exhausts it
 *      alone. Called from here, one cached response serves everyone.
 *   2. `COINGECKO_API_KEY` is optional but must stay server-side if it is set,
 *      the same rule the AI provider keys follow. There is no `NEXT_PUBLIC_`
 *      form of it and there should not be.
 *   3. The upstream shape is not our shape. Pinning the translation here means a
 *      change to their response is a change to one file, not to a component.
 *
 * The symbol is never interpolated into the outbound URL. It is resolved through
 * the allowlist in feeds.ts first, and an unknown symbol never reaches `fetch` —
 * a request proxy that forwards arbitrary caller input is how you end up making
 * outbound requests on someone else's behalf.
 */

const UPSTREAM = "https://api.coingecko.com/api/v3/coins";

interface Cached {
  at: number;
  body: PriceSeriesResponse;
}

/*
 * Process-local cache, and honest about what that means: on a serverless host
 * each instance keeps its own, so the hit rate is lower than it looks and a cold
 * instance always goes upstream. That is fine — the cache exists to stop one
 * user's open tabs from hammering the feed, not to guarantee a global miss rate.
 * `inflight` is the other half: without it, five simultaneous first-time
 * requests for the same key all miss and all call upstream.
 */
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<PriceSeriesResponse>>();

/** Bounded so a long-lived instance charting many symbols cannot grow forever. */
const MAX_KEYS = 64;

function remember(key: string, body: PriceSeriesResponse, now: number) {
  if (cache.size >= MAX_KEYS) {
    // Evict the oldest write. Map preserves insertion order, so the first key
    // is the least recently *written* — good enough for a cache this small.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: now, body });
}

async function fetchSeries(
  symbol: string,
  feed: string,
  range: PriceRange,
  now: number,
): Promise<PriceSeriesResponse> {
  const spec = RANGE_SPECS[range];
  const url = `${UPSTREAM}/${encodeURIComponent(feed)}/market_chart?vs_currency=usd&days=${spec.days}`;

  const apiKey = process.env.COINGECKO_API_KEY;
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      ...(apiKey ? { "x-cg-demo-api-key": apiKey } : {}),
    },
    // Next caches fetches by default; this response is already cached above with
    // a TTL that knows the range, so opting out avoids two layers disagreeing.
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) throw new Error(`upstream ${res.status}`);

  const json: unknown = await res.json();
  const raw = (json as { prices?: unknown })?.prices;
  if (!Array.isArray(raw)) throw new Error("upstream shape");

  const cutoff = spec.window === null ? 0 : now - spec.window;
  const points: WirePoint[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [t, p] = entry;
    // Both must be finite numbers. A null close upstream would otherwise become
    // a break in the path, and `NaN` in an SVG `d` attribute silently voids the
    // whole line rather than just that segment.
    if (typeof t !== "number" || typeof p !== "number") continue;
    if (!Number.isFinite(t) || !Number.isFinite(p) || p <= 0) continue;
    if (t < cutoff) continue;
    points.push([Math.round(t), p]);
  }

  points.sort((a, b) => a[0] - b[0]);
  return { symbol, range, points };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = (params.get("symbol") ?? "").trim();
  const rangeParam = params.get("range") ?? DEFAULT_RANGE;

  const feed = feedFor(symbol);
  if (!feed) {
    // 404, not 400: the request was well-formed, we just do not carry a feed for
    // that asset. The client renders "no price feed" for this and nothing else,
    // so the two cases have to be distinguishable.
    return NextResponse.json({ error: "no feed for symbol" }, { status: 404 });
  }
  if (!isPriceRange(rangeParam)) {
    return NextResponse.json({ error: "unknown range" }, { status: 400 });
  }

  const canonical = symbol.toUpperCase();
  const key = `${feed}:${rangeParam}`;
  const now = Date.now();

  const fresh = cache.get(key);
  if (fresh && now - fresh.at < RANGE_SPECS[rangeParam].ttl) {
    // The cache is keyed by feed, so WETH and ETH share an entry. Echo back the
    // symbol that was actually asked for rather than whichever one warmed it.
    return NextResponse.json({ ...fresh.body, symbol: canonical });
  }

  try {
    let pending = inflight.get(key);
    if (!pending) {
      pending = fetchSeries(canonical, feed, rangeParam, now).finally(() => {
        inflight.delete(key);
      });
      inflight.set(key, pending);
    }
    const body = await pending;
    remember(key, body, now);
    return NextResponse.json({ ...body, symbol: canonical });
  } catch (err) {
    /*
     * Serve stale before serving nothing. A rate-limited minute should show an
     * hour-old line, not an empty box — the chart is decoration around a form,
     * and losing it is worse than it being slightly behind. The `stale` flag
     * lets the client say so instead of presenting old data as current.
     */
    if (fresh) {
      return NextResponse.json({
        ...fresh.body,
        symbol: canonical,
        stale: true,
      });
    }
    console.warn(
      `[prices] ${key} failed:`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: "price feed unavailable" },
      { status: 502 },
    );
  }
}
