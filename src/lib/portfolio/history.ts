/**
 * The Overview's balance chart: what TODAY'S holdings were worth over the chosen
 * window, at each moment's price. No per-wallet balance history is stored (see
 * the Portfolio Rebuild Spec), so this is the honest chart we can draw: holdings
 * are fixed at today's amounts and re-priced along each token's USD history.
 *
 *   value(t) = Σ amount_i × price_i(t)  +  rest
 *
 * where the sum covers tokens with a price history, and `rest` is everything else
 * held at today's value (dollar stables, tokens with no feed, protocol positions).
 * So the line always ends exactly on the headline Portfolio value.
 */
export interface Holding {
  symbol: string;
  amount: number;
  valueUsd: number;
}
export type Series = [number, number][]; // [epoch ms, usd], oldest first

export interface HistoryPoint {
  t: number;
  v: number;
}

/** Price of a series at time t: the last point at or before t, else the first. */
function priceAt(s: Series, t: number): number {
  let lo = 0;
  let hi = s.length - 1;
  if (t <= s[0][0]) return s[0][1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  return s[lo][1];
}

export function portfolioHistory(
  holdings: Holding[],
  series: Record<string, Series>,
  netValue: number,
  now = Date.now(),
): HistoryPoint[] {
  const charted = holdings.filter(
    (h) => h.amount > 0 && (series[h.symbol.toUpperCase()]?.length ?? 0) > 0,
  );
  if (!charted.length) return [];
  const chartedNow = charted.reduce((s, h) => s + h.valueUsd, 0);
  const rest = netValue - chartedNow;
  /* The time grid is the densest series' timestamps, plus "now". */
  const grid = charted
    .map((h) => series[h.symbol.toUpperCase()])
    .reduce((a, b) => (b.length > a.length ? b : a))
    .map(([t]) => t)
    .filter((t) => t < now);
  grid.push(now);
  return grid.map((t) => ({
    t,
    v:
      t === now
        ? netValue
        : rest +
          charted.reduce((s, h) => s + h.amount * priceAt(series[h.symbol.toUpperCase()], t), 0),
  }));
}

/** First-to-last change of the line, in USD and as a fraction (null under 2 points). */
export function historyChange(pts: HistoryPoint[]): { abs: number; pct: number | null } | null {
  if (pts.length < 2) return null;
  const a = pts[0].v;
  const b = pts[pts.length - 1].v;
  return { abs: b - a, pct: a > 0 ? b / a - 1 : null };
}
