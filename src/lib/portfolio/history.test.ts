import { portfolioHistory, historyChange } from "./history";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
};

const series = { ETH: [[1000, 2000], [2000, 2500], [3000, 3000]] as [number, number][] };
const pts = portfolioHistory(
  [
    { symbol: "eth", amount: 1, valueUsd: 3000 },
    { symbol: "USDC", amount: 500, valueUsd: 500 }, // no series: held flat
  ],
  series,
  3600, // net value includes $100 of something else
  4000,
);
check("one point per series step, plus now", pts.length === 4);
check("re-prices the charted token, keeps the rest flat", pts[0].v === 600 + 2000);
check("follows the price", pts[1].v === 600 + 2500);
check("ends exactly on the net value", pts[3].t === 4000 && pts[3].v === 3600);
check("no charted holdings → no line", portfolioHistory([{ symbol: "USDC", amount: 5, valueUsd: 5 }], series, 5, 4000).length === 0);
const ch = historyChange(pts)!;
check("change in USD", ch.abs === 1000);
check("change as a fraction", Math.abs((ch.pct ?? 0) - 1000 / 2600) < 1e-12);
check("change needs two points", historyChange([{ t: 1, v: 1 }]) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
