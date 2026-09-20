import { hasUsablePoolPrice, type PoolState } from "./pool";

const pool = (price: number | null, liquidity: string): PoolState => ({
  address: "0x0000000000000000000000000000000000000001",
  tick: 0,
  price,
  liquidity,
});

const cases: Array<[string, boolean]> = [
  ["uses a priced pool with active liquidity", hasUsablePoolPrice(pool(1, "1"))],
  ["rejects a zero-liquidity pool price", !hasUsablePoolPrice(pool(2097.9589, "0"))],
  ["rejects a pinned pool price", !hasUsablePoolPrice(pool(null, "1"))],
  ["rejects a missing pool", !hasUsablePoolPrice(null)],
];

let failed = 0;
for (const [name, ok] of cases) {
  if (!ok) {
    failed += 1;
    console.error(`not ok - ${name}`);
  } else console.log(`ok - ${name}`);
}
if (failed) process.exit(1);
console.log(`${cases.length} passed, 0 failed`);
