"use client";

import { useId, useMemo, useState } from "react";
import { usePriceSeries, type PricePoint } from "@/hooks/v2/usePriceSeries";
import { DEFAULT_RANGE, RANGES, type PriceRange } from "@/lib/v2/prices/feeds";
import type { ChartPair } from "./ChartPanel";
import TokenIcon, { hasTokenIcon } from "./TokenIcon";
import s from "./PriceChart.module.css";

/**
 * The price panel beside the trade card.
 *
 * Hand-rolled SVG, and that is a decision rather than a shortcut: nothing in
 * package.json draws charts (no recharts, d3, visx, lightweight-charts), and the
 * smallest of those is a larger download than this whole route for one line and
 * a fill. If a second, richer chart ever lands — depth, candles, volume — that is
 * the point to reach for a library, not this.
 *
 * What the panel will not do is imply a number it does not have. Three states
 * that look similar and are not: no feed for this symbol (KLD has no market
 * because it has no deployment), the feed failed, and the feed answered with a
 * flat line. Each says which one it is.
 */

/**
 * Significant digits follow the magnitude, because one rule cannot serve both
 * ends of this list. A stablecoin's whole story is in the fourth decimal —
 * `$1.00` hides the depeg this panel exists to show — and ETH at `$3,000.4821`
 * is four digits of noise.
 */
function usd(value: number): string {
  const max = value >= 1000 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: max,
  });
}

/** Absolute move, same precision rule, sign carried by the caret not the digits. */
function usdDelta(value: number): string {
  return usd(Math.abs(value));
}

interface Geometry {
  line: string;
  area: string;
  /** Where the last point sits, as percentages, for the end dot. */
  endX: number;
  endY: number;
}

/**
 * Points to path data in a 0–100 by 0–100 box.
 *
 * The box is unitless and the SVG stretches it with
 * `preserveAspectRatio="none"`, so the plot fills whatever space the panel gets
 * without recomputing on resize. The cost is that stroke width would stretch too
 * — handled with `vector-effect="non-scaling-stroke"` on the path — and that a
 * circle would render as an ellipse, which is why the end dot is an HTML element
 * positioned in percent rather than an SVG `<circle>`.
 */
function geometry(points: PricePoint[]): Geometry | null {
  if (points.length === 0) return null;

  const values = points.map((d) => d.p);
  let min = Math.min(...values);
  let max = Math.max(...values);

  /*
   * A flat series has zero range, and dividing by it puts NaN in the `d`
   * attribute — which voids the entire path, not just one segment, so the chart
   * would vanish rather than degrade. Open a symmetric window around the value
   * instead and the line draws through the middle, which is what "unchanged"
   * should look like.
   */
  if (max - min < Number.EPSILON) {
    const pad = Math.abs(max) > 0 ? Math.abs(max) * 0.001 : 1;
    min -= pad;
    max += pad;
  }

  const span = max - min;
  // Breathing room top and bottom so the extremes are not clipped by the frame.
  const PAD = 8;
  const height = 100 - PAD * 2;

  const xs =
    points.length === 1
      ? [50]
      : points.map((_, i) => (i / (points.length - 1)) * 100);
  const ys = points.map((d) => PAD + (1 - (d.p - min) / span) * height);

  const line = xs
    .map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${ys[i].toFixed(2)}`)
    .join(" ");

  // A single point has no line, so give it a flat one across the full width —
  // otherwise `M50 50` draws nothing at all and the panel looks broken.
  const single =
    points.length === 1
      ? `M0 ${ys[0].toFixed(2)} L100 ${ys[0].toFixed(2)}`
      : line;

  return {
    line: single,
    area: `${single} L100 100 L0 100 Z`,
    endX: xs[xs.length - 1],
    endY: ys[ys.length - 1],
  };
}

export default function PriceChart({
  symbol,
  pair,
  side,
  onSide,
}: {
  symbol: string | null;
  pair: ChartPair;
  side: 0 | 1;
  onSide: (side: 0 | 1) => void;
}) {
  const [range, setRange] = useState<PriceRange>(DEFAULT_RANGE);
  const { points, spot, change, loading, unsupported, error, stale } =
    usePriceSeries(symbol, range);

  // Unique per instance: two panels on one page would otherwise share a
  // gradient id and the second would silently repaint the first.
  const gradientId = useId();
  const geo = useMemo(() => geometry(points), [points]);

  const up = (change?.abs ?? 0) >= 0;
  const drawn = geo !== null;

  /* Both sides only when there are two distinct assets to switch between. On the
     agent tab there is one, and a toggle offering the same symbol twice is a
     control that does nothing. */
  const sides = useMemo(
    () =>
      pair.base && pair.quote && pair.base !== pair.quote
        ? [pair.base, pair.quote]
        : null,
    [pair.base, pair.quote],
  );

  return (
    <section className={s.panel} aria-label="Price chart">
      <header className={s.head}>
        <div className={s.ident}>
          <span
            className={`${s.avatar} ${hasTokenIcon(symbol) ? s.avatarArt : ""}`}
            aria-hidden
          >
            <TokenIcon
              symbol={symbol}
              size={22}
              fallback={(symbol ?? "—").slice(0, 3)}
            />
          </span>
          <span className={s.symbol}>{symbol ?? "No token"}</span>
        </div>

        {drawn && spot !== null ? (
          <>
            <div className={`${s.price} tabular`}>
              <span className={s.currency}>$</span>
              {usd(spot)}
            </div>
            {change ? (
              <div
                className={`${s.delta} ${up ? s.up : s.down} tabular`}
                title={`Change over ${range}`}
              >
                <span aria-hidden>{up ? "▲" : "▼"}</span>
                <span>
                  ${usdDelta(change.abs)} ({Math.abs(change.pct).toFixed(2)}%)
                </span>
              </div>
            ) : (
              <div className={s.deltaMuted}>Single sample in this window</div>
            )}
          </>
        ) : (
          <div className={s.priceMuted}>—</div>
        )}
      </header>

      <div className={s.plot}>
        {drawn ? (
          <>
            <svg
              className={s.svg}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden
              focusable="false"
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="currentColor"
                    stopOpacity="0.22"
                  />
                  <stop
                    offset="100%"
                    stopColor="currentColor"
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>
              <path
                d={geo.area}
                fill={`url(#${gradientId})`}
                className={up ? s.up : s.down}
              />
              <path
                d={geo.line}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className={up ? s.up : s.down}
              />
            </svg>
            <span
              className={`${s.dot} ${up ? s.up : s.down}`}
              style={{ left: `${geo.endX}%`, top: `${geo.endY}%` }}
              aria-hidden
            />
            {/* The series as a table for anything not reading pixels. The SVG is
                aria-hidden, so without this the panel is silent to a screen
                reader — and a shape with no text alternative is the most common
                way a chart becomes inaccessible. */}
            <p className={s.sr}>
              {symbol} over {range}: {points.length} samples,
              {spot !== null ? ` last $${usd(spot)}` : ""}
              {change
                ? `, ${up ? "up" : "down"} ${Math.abs(change.pct).toFixed(2)} percent`
                : ""}
              .
            </p>
          </>
        ) : (
          <div className={s.empty}>
            {unsupported ? (
              symbol ? (
                <>
                  <b>No price feed for {symbol}</b>
                  <span>
                    Kaleido's own tokens have no market to read. Third-party
                    assets like ETH, USDC and WBTC chart normally.
                  </span>
                </>
              ) : (
                <>
                  <b>No token selected</b>
                  <span>Pick a token and its price appears here.</span>
                </>
              )
            ) : error ? (
              <>
                <b>Price feed unavailable</b>
                <span>
                  The upstream feed did not answer. Try another range.
                </span>
              </>
            ) : (
              <span className={s.loadingText}>
                {loading ? "Loading price history…" : "No data in this window."}
              </span>
            )}
          </div>
        )}
      </div>

      <footer className={s.foot}>
        <div className={s.ranges} role="group" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={`${s.rg} ${r === range ? s.rgOn : ""}`}
              onClick={() => setRange(r)}
              aria-pressed={r === range}
            >
              {r}
            </button>
          ))}
        </div>

        {sides && (
          <div className={s.sides} role="group" aria-label="Charted asset">
            {sides.map((sym, i) => (
              <button
                key={sym}
                type="button"
                className={`${s.sd} ${i === side ? s.sdOn : ""}`}
                onClick={() => onSide(i === 0 ? 0 : 1)}
                aria-pressed={i === side}
              >
                {sym}
              </button>
            ))}
          </div>
        )}
      </footer>

      {stale && (
        <p className={s.stale}>
          Showing the last cached prices — the feed is rate-limited right now.
        </p>
      )}
    </section>
  );
}
