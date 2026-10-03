"use client";

import { useEffect, useMemo, useState } from "react";
import { hasFeed, RANGES, type PriceRange } from "@/lib/v2/prices/feeds";
import { historyChange, portfolioHistory, type Holding, type Series } from "@/lib/portfolio/history";
import t from "./PortfolioTabs.module.css";

const W = 720;
const H = 200;
const PAD = 6;
/** Dollar stables chart as a flat $1 — no need to fetch a line for them. */
const FLAT = new Set(["USDC", "WUSDC", "USDT", "USDE", "USDG", "DAI", "KFUSD", "KAFUSD"]);
const MAX_SERIES = 8;

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The Overview's total-balance chart (see lib/portfolio/history): today's
 * holdings re-priced along each token's USD history for the chosen range, ending
 * on the Portfolio value. Fetches one price series per charted token (the top
 * MAX_SERIES by value with a feed; stables stay flat), from the same /api/prices
 * the trade chart uses.
 */
export default function BalanceChart({
  holdings,
  netValue,
}: {
  holdings: Holding[];
  netValue: number | null;
}) {
  const [range, setRange] = useState<PriceRange>("1D");
  const [series, setSeries] = useState<Record<string, Series>>({});
  const symbols = useMemo(
    () =>
      [...holdings]
        .filter((h) => h.valueUsd > 0 && !FLAT.has(h.symbol.toUpperCase()) && hasFeed(h.symbol))
        .sort((a, b) => b.valueUsd - a.valueUsd)
        .slice(0, MAX_SERIES)
        .map((h) => h.symbol.toUpperCase()),
    [holdings],
  );
  const key = symbols.join(",");

  useEffect(() => {
    if (!key) {
      setSeries({});
      return;
    }
    const ctl = new AbortController();
    Promise.all(
      key.split(",").map((sym) =>
        fetch(`/api/prices?symbol=${encodeURIComponent(sym)}&range=${range}`, { signal: ctl.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => [sym, (d?.points ?? []) as Series] as const)
          .catch(() => [sym, [] as Series] as const),
      ),
    ).then((pairs) => {
      if (!ctl.signal.aborted) setSeries(Object.fromEntries(pairs.filter(([, s]) => s.length > 0)));
    });
    return () => ctl.abort();
  }, [key, range]);

  const pts = useMemo(
    () => (netValue === null ? [] : portfolioHistory(holdings, series, netValue)),
    [holdings, series, netValue],
  );
  const change = historyChange(pts);

  let line = "";
  let area = "";
  if (pts.length >= 2) {
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    const lo = Math.min(...pts.map((p) => p.v));
    const hi = Math.max(...pts.map((p) => p.v));
    const span = hi - lo || Math.max(hi * 0.01, 1);
    const x = (tt: number) => PAD + ((tt - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
    const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
    line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
    area = `${line} L${x(t1).toFixed(1)},${H} L${x(t0).toFixed(1)},${H} Z`;
  }
  const up = (change?.abs ?? 0) >= 0;
  const label = { "1H": "past hour", "1D": "today", "1W": "past week", "1M": "past month", "1Y": "past year" }[range];

  return (
    <div className={t.bal}>
      <div className={t.balTop}>
        <span className={up ? t.balUp : t.balDown}>
          {change ? (
            <>
              {up ? "▲" : "▼"} {money(Math.abs(change.abs))}
              {change.pct !== null ? ` (${Math.abs(change.pct * 100).toFixed(2)}%)` : ""} {label}
            </>
          ) : (
            "\u00a0"
          )}
        </span>
        <div className={t.ranges} role="tablist" aria-label="Chart range">
          {RANGES.filter((r) => r !== "1H").map((r) => (
            <button key={r} className={`${t.rangeBt} ${r === range ? t.rangeOn : ""}`} onClick={() => setRange(r)} aria-selected={r === range} role="tab">
              {r}
            </button>
          ))}
        </div>
      </div>
      {pts.length >= 2 ? (
        <svg
          className={t.balSvg}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-label="Portfolio value over time"
        >
          <title>Value of your current holdings at each moment&apos;s price</title>
          <defs>
            <linearGradient id="bal-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={up ? "var(--k-pos)" : "var(--k-neg)"} stopOpacity="0.25" />
              <stop offset="100%" stopColor={up ? "var(--k-pos)" : "var(--k-neg)"} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#bal-fill)" />
          <path d={line} fill="none" stroke={up ? "var(--k-pos)" : "var(--k-neg)"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <div className={t.balNone}>
          {symbols.length === 0 ? "Your holdings are stable — the value is flat." : "Loading the chart…"}
        </div>
      )}
    </div>
  );
}
