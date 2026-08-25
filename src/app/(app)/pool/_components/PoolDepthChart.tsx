import { pct, qty } from "@/lib/format/figures";
import { MAX_FRACTION, MIN_FRACTION, type CurvePoint } from "../poolCurve";

import s from "../pool.module.css";

/**
 * The pair's own execution curve — what a trade costs against spot, by size.
 *
 * The one chart on this page that is not an extrapolation. Price, volume and
 * liquidity over time all need an indexer holding per-block snapshots, which is
 * why `usePoolData` deleted its two `*Change24h` fields rather than shipping
 * zeroes; there is nothing to draw them from. Depth needs no history at all,
 * because a constant-product pair's whole curve follows from the reserves it
 * holds right now (`KaleidoSwapPair.sol:243-247`) and the fee it charges. Every
 * point below is `KaleidoSwapLibrary.getAmountOut` run at a different size.
 *
 * SVG rather than a charting library: two polylines and five ticks do not
 * justify a dependency, and the deleted `PoolLiquidityChart` was the only chart
 * component this section ever had.
 */

/* Nominal units. The viewBox scales to the panel, so these are proportions
   rather than pixels — only their ratios matter. */
const W = 520;
const H = 190;
const PAD_L = 42;
/* Wider than it needs to be for the line, because the rightmost x label is
   centred on the last tick and the browser's UA stylesheet clips the root `<svg>`
   at its viewBox. At PAD_R 10 the final character of "50%" fell outside 520 and
   was cut in half. */
const PAD_R = 16;
const PAD_T = 12;
const PAD_B = 24;
const PW = W - PAD_L - PAD_R;
const PH = H - PAD_T - PAD_B;

/** Where the x ticks go, as a fraction of the input reserve. Every one of these
    is inside the curve's declared domain, so none of them is filtered out. */
const X_TICKS = [MIN_FRACTION, 0.001, 0.01, 0.1, MAX_FRACTION];
const tickLabel = (f: number) => `${+(f * 100).toFixed(2)}%`;

/** Sizes the reference rows quote, so a reader gets numbers and not only a shape. */
const REFERENCE = [0.001, 0.01, 0.05, 0.1];

export default function PoolDepthChart({
  sell0,
  sell1,
  symbol0,
  symbol1,
}: {
  sell0: CurvePoint[];
  sell1: CurvePoint[];
  symbol0: string;
  symbol1: string;
}) {
  /* Either side empty means the pair cannot quote — an empty leg. Saying so
     beats an axis frame with nothing in it, which reads as a failed render. */
  if (sell0.length === 0 || sell1.length === 0) {
    return (
      <div className={s.chartEmpty}>
        This pool has an empty side, so it has no curve to trade along.
      </div>
    );
  }

  /* The x axis is the curve's declared domain, not the span of the points that
     came back. Those are the same thing except for float rounding at the ends —
     and where they are not, the curve stopped short because the pool is too
     small to quote the smallest sampled size, in which case a line that starts
     partway across is the honest picture and a rescaled axis is not. */
  const logMin = Math.log(MIN_FRACTION);
  const logSpan = Math.log(MAX_FRACTION) - logMin;

  /* One y-scale across both directions. Two independent scales would draw the
     cheaper side as steeply as the dearer one, which is the opposite of what a
     reader takes from the picture. */
  const yMax = Math.max(
    ...sell0.map((p) => p.costPct),
    ...sell1.map((p) => p.costPct),
  );

  const x = (fraction: number) =>
    PAD_L + ((Math.log(fraction) - logMin) / logSpan) * PW;
  const y = (cost: number) => PAD_T + (1 - cost / yMax) * PH;

  const path = (pts: CurvePoint[]) =>
    pts
      .map((p) => `${x(p.fraction).toFixed(2)},${y(p.costPct).toFixed(2)}`)
      .join(" ");

  const yTicks = [0, yMax / 2, yMax];

  return (
    <>
      <svg
        className={s.chart}
        viewBox={`0 0 ${W} ${H}`}
        /* No `preserveAspectRatio="none"`. Non-uniform scaling would stretch the
           tick text along with the geometry, so the stylesheet sizes this by
           width and lets the 520:190 ratio set the height instead. */
        role="img"
        aria-label={`Trade cost against spot price by size, for ${symbol0} and ${symbol1}`}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line
              className={s.chartGrid}
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(t)}
              y2={y(t)}
            />
            <text className={s.chartYLabel} x={PAD_L - 6} y={y(t)}>
              {pct(t, t === 0 ? 0 : 1)}
            </text>
          </g>
        ))}

        {X_TICKS.map((f) => (
          <text key={f} className={s.chartXLabel} x={x(f)} y={H - 8}>
            {tickLabel(f)}
          </text>
        ))}

        <polyline className={s.chartLine0} points={path(sell0)} />
        <polyline className={s.chartLine1} points={path(sell1)} />
      </svg>

      <div className={s.chartFoot}>
        <span className={s.chartKey}>
          <span className={`${s.balDot} ${s.balDot0}`} aria-hidden="true" />
          Sell {symbol0}
        </span>
        <span className={s.chartKey}>
          <span className={`${s.balDot} ${s.balDot1}`} aria-hidden="true" />
          Sell {symbol1}
        </span>
        {/* Names both axes, because "cost" here is fee plus curve rather than
            the fee-free price impact the two are often confused for. */}
        <span className={s.chartAxis}>
          cost vs spot, by trade size as a share of the pool
        </span>
      </div>

      <ReferenceRows
        sell0={sell0}
        sell1={sell1}
        symbol0={symbol0}
        symbol1={symbol1}
      />
    </>
  );
}

/** Nearest sampled point to a target size. The curve is sampled, not solved, so
    a quoted row has to name the size it actually measured. */
const nearest = (pts: CurvePoint[], target: number) =>
  pts.reduce((best, p) =>
    Math.abs(p.fraction - target) < Math.abs(best.fraction - target) ? p : best,
  );

/**
 * The chart in numbers.
 *
 * A curve answers "is this pool deep" but not "what does my trade cost", and the
 * second is the question someone opens this page with. Four sizes, both
 * directions, read off the same samples the line is drawn from — so the table
 * and the picture cannot disagree.
 */
function ReferenceRows({
  sell0,
  sell1,
  symbol0,
  symbol1,
}: {
  sell0: CurvePoint[];
  sell1: CurvePoint[];
  symbol0: string;
  symbol1: string;
}) {
  return (
    <div className={s.refTable}>
      <div className={s.refHead}>
        <span>Trade size</span>
        <span className={s.right}>Sell {symbol0}</span>
        <span className={s.right}>Sell {symbol1}</span>
      </div>
      {REFERENCE.filter(
        (f) =>
          f >= sell0[0]!.fraction && f <= sell0[sell0.length - 1]!.fraction,
      ).map((f) => {
        const a = nearest(sell0, f);
        const b = nearest(sell1, f);
        return (
          <div key={f} className={s.refRow}>
            <span>{tickLabel(f)} of pool</span>
            {/* The size is quoted per column, not once. One percent of the pool
                is one percent of *that leg*, so a single figure labelled with
                token0 would describe only the left column while sitting under
                both. */}
            <RefCell point={a} symbol={symbol0} />
            <RefCell point={b} symbol={symbol1} />
          </div>
        );
      })}
    </div>
  );
}

function RefCell({ point, symbol }: { point: CurvePoint; symbol: string }) {
  return (
    <span className={`${s.refCell} ${s.right}`}>
      <span className="tabular">{pct(point.costPct)}</span>
      <span className={`${s.refQty} tabular`}>
        {qty(point.amountIn, point.amountIn >= 1000 ? 0 : 4)} {symbol}
      </span>
    </span>
  );
}
