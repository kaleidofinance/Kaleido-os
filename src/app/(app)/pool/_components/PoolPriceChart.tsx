"use client";

import { useMemo, useState } from "react";
import type { PoolTxn } from "@/hooks/dex/usePoolTransactions";
import { priceSeries, seriesChange } from "@/lib/dex/priceSeries";
import s from "../pool.module.css";

const W = 640;
const H = 220;
const PAD = 8;

const fmt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : n < 100 ? 4 : 2 });

/**
 * The pool's price card, leading the page the way Uniswap's pool view does: the
 * live price large, its change over the swaps this page has read, and a line
 * through those swaps (see lib/dex/priceSeries — every point is a real swap,
 * ending at the live price). The pair can be flipped. With fewer than two points
 * there is no line to draw, so the card shows the price alone.
 */
export default function PoolPriceChart({
  txns,
  livePrice,
  symbol0,
  symbol1,
}: {
  txns: PoolTxn[];
  livePrice: number | null;
  symbol0: string;
  symbol1: string;
}) {
  const [flip, setFlip] = useState(false);
  const pts = useMemo(() => {
    const raw = priceSeries(txns, livePrice);
    return flip ? raw.map((p) => ({ at: p.at, price: 1 / p.price })) : raw;
  }, [txns, livePrice, flip]);
  const base = flip ? symbol1 : symbol0;
  const quote = flip ? symbol0 : symbol1;
  const last = pts[pts.length - 1]?.price ?? null;
  const change = seriesChange(pts);

  let path = "";
  let area = "";
  if (pts.length >= 2) {
    const t0 = pts[0].at;
    const t1 = pts[pts.length - 1].at || t0 + 1;
    const lo = Math.min(...pts.map((p) => p.price));
    const hi = Math.max(...pts.map((p) => p.price));
    const span = hi - lo || hi * 0.01 || 1;
    const x = (t: number) => PAD + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
    const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
    path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
    area = `${path} L${x(t1).toFixed(1)},${H} L${x(t0).toFixed(1)},${H} Z`;
  }
  const up = (change ?? 0) >= 0;

  return (
    <div className={`${s.panel} ${s.priceCard}`}>
      <div className={s.priceTop}>
        <div>
          <div className={`${s.priceBig} tabular`}>
            {last === null ? "0" : fmt(last)} <span className={s.priceUnit}>{quote}</span>
          </div>
          <div className={s.priceSub}>
            per 1 {base}
            {change !== null ? (
              <span className={up ? s.pricePos : s.priceNeg}>
                {up ? "▲" : "▼"} {Math.abs(change * 100).toFixed(2)}%
              </span>
            ) : null}
          </div>
        </div>
        <button className={s.flipBt} onClick={() => setFlip((f) => !f)} title="Flip the pair">
          {quote} / {base} ⇄
        </button>
      </div>
      {pts.length >= 2 ? (
        <svg className={s.priceSvg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={`${base} price in ${quote}`}>
          <defs>
            <linearGradient id="pool-price-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={up ? "var(--k-pos)" : "var(--k-neg)"} stopOpacity="0.28" />
              <stop offset="100%" stopColor={up ? "var(--k-pos)" : "var(--k-neg)"} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#pool-price-fill)" />
          <path d={path} fill="none" stroke={up ? "var(--k-pos)" : "var(--k-neg)"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <div className={s.priceNone}>No swaps yet in the window this page reads — the price above is live.</div>
      )}
    </div>
  );
}
