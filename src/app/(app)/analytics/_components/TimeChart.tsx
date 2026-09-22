import s from "./TimeChart.module.css";

/**
 * A small inline-SVG area chart for one daily metric. Inline rather than a chart
 * library: four trend sparklines do not need a canvas engine, and inline SVG
 * takes the theme tokens directly and scales with the card. Points are daily
 * values oldest → newest; the headline is a pre-formatted window summary.
 */
export function TimeChart({
  label,
  summary,
  points,
  hint,
}: {
  label: string;
  summary: string;
  points: number[];
  hint?: string;
}) {
  const W = 300;
  const H = 64;
  const PAD = 4;
  const n = points.length;
  const max = Math.max(1, ...points);
  const min = Math.min(0, ...points);
  const range = max - min || 1;
  const x = (i: number) => PAD + (i / Math.max(1, n - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - min) / range) * (H - 2 * PAD);

  const line =
    n > 0
      ? points
          .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
          .join(" ")
      : "";
  const area = n > 1 ? `${line} L${x(n - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z` : "";

  return (
    <div className={s.card}>
      <div className={s.top}>
        <span className={s.label}>{label}</span>
        {hint ? <span className={s.hint}>{hint}</span> : null}
      </div>
      <div className={s.value}>{summary}</div>
      <svg
        className={s.svg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} trend`}
      >
        {n > 1 ? (
          <>
            <path d={area} className={s.area} />
            <path d={line} className={s.line} vectorEffect="non-scaling-stroke" />
            <circle cx={x(n - 1)} cy={y(points[n - 1])} r={2.5} className={s.dot} />
          </>
        ) : (
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className={s.flat} />
        )}
      </svg>
    </div>
  );
}
