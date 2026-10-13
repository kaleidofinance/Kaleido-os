import { livePoolPrice, shouldPublishV3Pool } from "./poolSweep";

let passed = 0;
let failed = 0;
const check = (name: string, condition: boolean, detail = "") => {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

check(
  "an unfunded V3 pool does not publish its stale opening tick",
  livePoolPrice(2097.9589, "0") === null,
);
check(
  "a funded V3 pool keeps its live price",
  livePoolPrice(0.86555, "1") === 0.86555,
);
check(
  "invalid liquidity fails closed",
  livePoolPrice(1, "not-a-number") === null,
);
check(
  "an empty discovered pool is not published",
  !shouldPublishV3Pool({ liquidity: "0" }),
);
check(
  "a funded discovered pool is published",
  shouldPublishV3Pool({ liquidity: "1" }),
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
