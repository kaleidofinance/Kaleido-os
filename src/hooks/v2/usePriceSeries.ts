"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_RANGE,
  hasFeed,
  type PriceRange,
  type WirePoint,
} from "@/lib/v2/prices/feeds";

/**
 * The price series behind the trade chart.
 *
 * Deliberately not `usePriceHistory` (hooks/dex), which reads `Sync` events off
 * a deployed V2 pair. That hook is the right one *eventually* — a chart drawn
 * from our own pool is the honest number for our own pool — but there are no
 * pairs deployed, so today it returns an empty array on every chain. This reads
 * the wider market instead, through `/api/prices`, and says which it is: the
 * chart is labelled USD spot, not "the price you will get here".
 *
 * Also not `useTokenUsdPrice`, which needs `token.priceUrl` — a field
 * `toIToken()` has never populated, so it returns null for every registry token
 * in the app. Resolution happens by symbol through the feeds allowlist instead.
 */

export interface PricePoint {
  /** Epoch milliseconds. */
  t: number;
  /** USD. */
  p: number;
}

export interface PriceChange {
  abs: number;
  pct: number;
}

export interface PriceSeries {
  points: PricePoint[];
  /** Last close in the window. Null until something loads. */
  spot: number | null;
  /** Movement across the window, first close to last. */
  change: PriceChange | null;
  loading: boolean;
  /** No feed carries this symbol. Not an error — there is just nothing to draw. */
  unsupported: boolean;
  /** The feed exists but did not answer. */
  error: boolean;
  /** Served from cache after an upstream failure, so the line is behind. */
  stale: boolean;
}

const EMPTY: PricePoint[] = [];

export function usePriceSeries(
  symbol: string | null | undefined,
  range: PriceRange = DEFAULT_RANGE,
): PriceSeries {
  /* Resolved before the state below, because `loading`'s initial value depends
     on it. `hasFeed` is a synchronous lookup in a frozen allowlist, so this is
     the same answer on the server and in the browser — which is what makes it
     safe to seed state from. */
  const supported = hasFeed(symbol);
  const canonical = supported ? (symbol as string).toUpperCase() : null;

  const [points, setPoints] = useState<PricePoint[]>(EMPTY);

  /*
   * SEEDED TRUE FOR A SUPPORTED SYMBOL, AND THAT IS A FIX RATHER THAN A
   * PREFERENCE. This was `useState(false)`, and `setLoading(true)` lives in the
   * effect below — which does not run during a server render. So the first
   * frame of a supported symbol was `points: []`, `loading: false`,
   * `unsupported: false`, `error: false`, and PriceChart reads exactly that
   * combination as "the feed answered with nothing": it printed **"No data in
   * this window."** over an empty plot until the fetch resolved.
   *
   * Inside the app that was nearly invisible — the chart sits behind
   * ChartPanel's collapsed-by-default storage flag on a client-rendered authed
   * route — but the landing page prerenders the panel, so the shipped HTML
   * carried that sentence about live ETH data as the first thing a visitor read.
   * It was never true; the request had not been made yet.
   *
   * A supported symbol *will* be fetched, on the next tick, unconditionally. So
   * the honest initial state is "loading", and the initialiser says so rather
   * than the component having to special-case an empty pre-effect render.
   * `false` when the symbol has no feed is equally honest: nothing is going to
   * be fetched, and `unsupported` is the flag the panel branches on there.
   *
   * Both `symbol` transitions stay correct without a second effect, because a
   * useState initialiser runs once and the effect owns every later value:
   * supported → unsupported hits the `!canonical` branch, which clears it to
   * false; unsupported → supported hits `setLoading(true)`.
   */
  const [loading, setLoading] = useState(supported);
  const [error, setError] = useState(false);
  const [stale, setStale] = useState(false);

  /*
   * Guards the async write. Without it, switching from 1Y to 1H while the year
   * is still in flight lets the slower response land last and repaint the year
   * under the "1H" chip — the classic out-of-order fetch, and the reason this is
   * a ref rather than the abort signal alone. Abort covers the network; the
   * token covers a response that was already parsed when the switch happened.
   */
  const latest = useRef(0);

  useEffect(() => {
    if (!canonical) {
      setPoints(EMPTY);
      setLoading(false);
      setError(false);
      setStale(false);
      return;
    }

    const ticket = ++latest.current;
    const controller = new AbortController();
    setLoading(true);

    fetch(
      `/api/prices?symbol=${encodeURIComponent(canonical)}&range=${range}`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { points?: WirePoint[]; stale?: boolean };
      })
      .then((data) => {
        if (ticket !== latest.current) return;
        const next = Array.isArray(data.points)
          ? data.points.map(([t, p]) => ({ t, p }))
          : EMPTY;
        setPoints(next);
        setStale(Boolean(data.stale));
        setError(false);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted || ticket !== latest.current) return;
        console.warn(`[prices] ${canonical} ${range}:`, err);
        setPoints(EMPTY);
        setError(true);
        setLoading(false);
      });

    return () => controller.abort();
  }, [canonical, range]);

  const { spot, change } = useMemo(() => {
    if (points.length === 0) return { spot: null, change: null };
    const first = points[0].p;
    const last = points[points.length - 1].p;
    return {
      spot: last,
      // A single point is a price, not a movement. Reporting 0.00% for it would
      // claim the asset was flat across a window we only sampled once.
      change:
        points.length < 2
          ? null
          : {
              abs: last - first,
              pct: first === 0 ? 0 : ((last - first) / first) * 100,
            },
    };
  }, [points]);

  return {
    points,
    spot,
    change,
    loading,
    unsupported: !supported,
    error,
    stale,
  };
}
