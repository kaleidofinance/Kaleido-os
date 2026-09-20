import {
  initialPriceDeviation,
  isInitialPriceWithinTolerance,
} from "./liquidity";

const cases: Array<[string, boolean]> = [
  [
    "accepts a first pool at the reference price",
    isInitialPriceWithinTolerance("100", "87", 0.87),
  ],
  [
    "accepts a price inside the ten percent band",
    isInitialPriceWithinTolerance("100", "94.8", 0.87),
  ],
  [
    "rejects a materially wrong opening price",
    !isInitialPriceWithinTolerance("1", "2097.9589", 0.87),
  ],
  [
    "rejects a missing reference",
    !isInitialPriceWithinTolerance("1", "1", null),
  ],
  [
    "reports the relative deviation",
    Math.abs((initialPriceDeviation("1", "1", 0.8) ?? 0) - 0.25) < 1e-12,
  ],
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
