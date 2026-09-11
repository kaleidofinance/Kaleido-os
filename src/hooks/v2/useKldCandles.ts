"use client";

import { useEffect, useRef, useState } from "react";

import type {
  Candle,
  Interval,
  KldCandleResponse,
} from "@/lib/v2/prices/candles";

/**
 * The KLD candle series for a chain, from /api/prices/kld.
 *
 * The candlestick counterpart to usePriceSeries. That hook prices thirteen
 * symbols off CoinGecko as a close-only line; this one prices KLD off our own
 * pool as OHLC, because KLD has no market to quote and the only honest price is
 * what our pool last traded at. Chain-scoped on purpose — there is no arbitrage
 * between testnet pools, so KLD's price is per chain and the caller passes which.
 *
 * `unsupported` is the Arc case: a chain with no KLD pool. It is distinct from
 * an empty series on a chain that has one, which is the honest "nothing has
 * traded in this window yet". A chart draws neither as a flat line — one says
 * "no market here", the other "no trades yet".
 */
const EMPTY: Candle[] = [];

export interface KldCandles {
  candles: Candle[];
  /** The pool the series is from, or null when the chain has none. */
  pool: string | null;
  loading: boolean;
  error: boolean;
  /** No KLD pool on this chain — nothing to draw, and not a fault. */
  unsupported: boolean;
}

export function useKldCandles(
  chainId: number | undefined,
  interval: Interval = "1h",
  limit = 300,
): KldCandles {
  const [candles, setCandles] = useState<Candle[]>(EMPTY);
  const [pool, setPool] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(chainId));
  const [error, setError] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  /*
   * Same guard usePriceSeries carries: switching interval while a slower request
   * is in flight must not let the stale response land last and repaint under the
   * new chip. The ticket covers a response already parsed when the switch
   * happened; the abort covers the network.
   */
  const latest = useRef(0);

  useEffect(() => {
    if (!chainId) {
      setCandles(EMPTY);
      setPool(null);
      setLoading(false);
      setError(false);
      setUnsupported(false);
      return;
    }

    const ticket = ++latest.current;
    const controller = new AbortController();
    setLoading(true);
    setError(false);

    const url = `/api/prices/kld?chainId=${chainId}&interval=${interval}&limit=${limit}`;
    fetch(url, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<KldCandleResponse>) : Promise.reject(r.status)))
      .then((body) => {
        if (ticket !== latest.current) return; // a newer request won
        setCandles(body.candles ?? EMPTY);
        setPool(body.pool);
        setUnsupported(body.pool === null);
        setError(false);
        setLoading(false);
      })
      .catch((e) => {
        if (controller.signal.aborted || ticket !== latest.current) return;
        setError(true);
        setLoading(false);
        void e;
      });

    return () => controller.abort();
  }, [chainId, interval, limit]);

  return { candles, pool, loading, error, unsupported };
}
