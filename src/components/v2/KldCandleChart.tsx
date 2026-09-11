"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CandlestickData,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
} from "lightweight-charts";

import { INTERVALS, type Interval } from "@/lib/v2/prices/candles";
import { useKldCandles } from "@/hooks/v2/useKldCandles";
import s from "./KldCandleChart.module.css";

/**
 * KLD's candlestick chart, drawn from our own pool.
 *
 * The last piece of the candle stack, and the first that is worth seeing. It is
 * a separate component from PriceChart on purpose: PriceChart is a close-only
 * line over a CoinGecko feed keyed by SYMBOL, and KLD has no CoinGecko feed and
 * no single price — its market is per chain. So this is chain-scoped, reads
 * useKldCandles, and renders real OHLC through lightweight-charts, the library
 * PriceChart's own comment said to reach for once "a second, richer chart —
 * depth, candles, volume" arrived. This is that chart.
 *
 * ── Why the library loads inside the effect ─────────────────────────────────
 *
 * lightweight-charts needs the DOM: `createChart` measures a container and draws
 * to a canvas. A client component still renders once on the SERVER for the
 * initial HTML, so a top-level import would run the library there. Importing it
 * inside the mount effect — which never runs on the server — keeps it off the
 * server path entirely, without an ssr:false wrapper the codebase has no other
 * instance of. The chart is absent from the first paint and appears on hydration,
 * which for a data view behind a fetch is what happens anyway.
 *
 * ── Why colours are read, not passed ────────────────────────────────────────
 *
 * The canvas cannot use a CSS variable, so the theme tokens are read off the
 * root with getComputedStyle at setup and re-read when the theme toggles — a
 * MutationObserver on the root's `data-theme`, the same attribute ThemeToggle
 * writes. Without that the candles keep their light-theme colours after a switch
 * to dark, on the one surface the rest of the page's `var()` colours cannot reach.
 */

function readTheme() {
  const root = document.documentElement;
  const v = (name: string, fallback: string) =>
    getComputedStyle(root).getPropertyValue(name).trim() || fallback;
  return {
    up: v("--k-pos", "#4cc46a"),
    down: v("--k-neg", "#ff5f52"),
    text: v("--k-t2", "#a8a49b"),
    grid: v("--k-line", "rgba(255,255,255,0.075)"),
    bg: "transparent",
  };
}

export default function KldCandleChart({
  chainId,
  className,
}: {
  chainId: number | undefined;
  className?: string;
}) {
  const [interval, setInterval] = useState<Interval>("1h");
  const { candles, loading, error, unsupported } = useKldCandles(chainId, interval);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  /* candle.t is unix seconds, which is exactly lightweight-charts' UTCTimestamp;
     the series wants ascending, unique time, which the store's bucket_start key
     already guarantees. */
  const data = useMemo<CandlestickData[]>(
    () =>
      candles.map((c) => ({
        time: c.t as UTCTimestamp,
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
      })),
    [candles],
  );

  /* Create the chart once, on mount, in the browser only. */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    let observer: MutationObserver | null = null;
    let resize: ResizeObserver | null = null;

    (async () => {
      const { createChart, ColorType, CrosshairMode } = await import(
        "lightweight-charts"
      );
      if (disposed || !containerRef.current) return;

      const theme = readTheme();
      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: theme.bg },
          textColor: theme.text,
          fontFamily: "inherit",
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: theme.grid },
          horzLines: { color: theme.grid },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: theme.grid },
        timeScale: { borderColor: theme.grid, timeVisible: true, secondsVisible: false },
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
        autoSize: false,
      });
      const series = chart.addCandlestickSeries({
        upColor: theme.up,
        downColor: theme.down,
        wickUpColor: theme.up,
        wickDownColor: theme.down,
        borderVisible: false,
      });

      chartRef.current = chart;
      seriesRef.current = series;
      if (data.length > 0) {
        series.setData(data);
        chart.timeScale().fitContent();
      }

      /* Follow the container's size — the panel is flex and can be any width. */
      resize = new ResizeObserver(() => {
        const c = containerRef.current;
        if (c) chart.resize(c.clientWidth, c.clientHeight);
      });
      resize.observe(containerRef.current);

      /* Re-read the tokens when the theme toggles; the canvas cannot do it itself. */
      observer = new MutationObserver(() => {
        const t = readTheme();
        chart.applyOptions({
          layout: { textColor: t.text },
          grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
          rightPriceScale: { borderColor: t.grid },
          timeScale: { borderColor: t.grid },
        });
        series.applyOptions({
          upColor: t.up,
          downColor: t.down,
          wickUpColor: t.up,
          wickDownColor: t.down,
        });
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "class"],
      });
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      resize?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // Mount once. Data is pushed through the separate effect below so a re-fetch
    // does not tear the chart down and rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Push new data without recreating the chart. */
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(data);
    if (data.length > 0) chartRef.current?.timeScale().fitContent();
  }, [data]);

  const showEmptyState = unsupported || error || (!loading && candles.length === 0);

  return (
    <section className={`${s.panel} ${className ?? ""}`} aria-label="KLD price chart">
      <header className={s.head}>
        <span className={s.title}>KLD / USDC</span>
        <div className={s.intervals} role="group" aria-label="Candle interval">
          {(Object.keys(INTERVALS) as Interval[]).map((iv) => (
            <button
              key={iv}
              type="button"
              className={`${s.iv} ${iv === interval ? s.ivOn : ""}`}
              onClick={() => setInterval(iv)}
              aria-pressed={iv === interval}
            >
              {iv}
            </button>
          ))}
        </div>
      </header>

      <div className={s.plotWrap}>
        {/* The canvas mounts here. It is kept in the tree even in an empty state
            so the chart is not torn down and rebuilt every time a chain with no
            trades is selected — the overlay simply covers it. */}
        <div ref={containerRef} className={s.plot} aria-hidden={showEmptyState} />

        {showEmptyState && (
          <div className={s.empty}>
            {unsupported ? (
              <p className={s.emptyText}>
                No KLD market on this chain yet.
                <span className={s.emptySub}>
                  KLD is priced from its own pool, and this network doesn&apos;t have one.
                </span>
              </p>
            ) : error ? (
              <p className={s.emptyText}>
                Couldn&apos;t load the price series.
                <span className={s.emptySub}>The read failed — try again shortly.</span>
              </p>
            ) : (
              <p className={s.emptyText}>
                No trades in this window yet.
                <span className={s.emptySub}>
                  The chart fills in as KLD trades on this chain.
                </span>
              </p>
            )}
          </div>
        )}

        {loading && candles.length === 0 && !unsupported && !error && (
          <div className={s.loading}>
            <span className={s.loadingText}>Loading candles…</span>
          </div>
        )}
      </div>
    </section>
  );
}
