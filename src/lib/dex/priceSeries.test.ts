import { priceSeries, seriesChange } from "./priceSeries";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
};

const tx = (at: number | null, a0: number, a1: number, kind: "swap" | "add" = "swap") =>
  ({ hash: "0x", kind, blockNumber: 1, logIndex: 0, at, amount0: a0, amount1: a1, soldToken0: true }) as never;

const s = priceSeries([tx(3000, 1, 0.9), tx(1000, 2, 1.7), tx(2000, 1, 1, "add"), tx(null, 1, 5), tx(1500, 0, 1)], 0.88, 5000);
check("keeps only priced swaps with a time", s.length === 3);
check("oldest first", s[0].at === 1000 && s[1].at === 3000);
check("price is token1 per token0", s[0].price === 0.85);
check("ends at the live price, now", s[2].at === 5000 && s[2].price === 0.88);
check("no swaps → just the live point", priceSeries([], 1.2, 10).length === 1);
check("no live price → swaps only", priceSeries([tx(1, 1, 2)], null, 10).length === 1);
check("change first→last", Math.abs((seriesChange(s) ?? 0) - (0.88 / 0.85 - 1)) < 1e-12);
check("change needs two points", seriesChange([{ at: 1, price: 1 }]) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
