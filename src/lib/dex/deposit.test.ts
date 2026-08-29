// Checks on the amount arithmetic behind the pools table's Deposit modal.
// Run with `npx tsx src/lib/dex/deposit.test.ts`.
//
// These three functions decide what goes into the second box when the reader
// types in the first, and every way they fail is quiet. A ratio applied the wrong
// way round still fills the box with a plausible number; a string with one digit
// too many for a 6-decimal token throws inside `parseUnits` two screens later,
// after two approvals have been signed; and a trailing-zero strip that eats a
// zero turns 100 USDC into 1.
//
// What is under test, in order of how badly it fails when wrong:
//
//   1. The output being parseable at all. `pairedAmount` feeds an input box whose
//      value is later handed to `ethers.parseUnits` with the token's own
//      decimals, and a float ratio produces 17 fractional digits by default.
//      Tests 1 and 3 run the results back through parseUnits.
//   2. The direction of the ratio. token1-per-token0 multiplied on the wrong leg
//      is off by ratio², which for a 3000 WETH/USDC pool is seven orders of
//      magnitude — and still a number. Test 2.
//   3. Zeros and infinities. A V3 range entirely off the market gives a ratio of
//      0 or Infinity, which are legitimate answers meaning "this side takes
//      nothing"; they must not reach the box as "0", "Infinity" or "NaN". Test 2.
//   4. Mixed decimals in the reserve ratio. USDC/WETH is 6/18, and reading the
//      raw reserves without scaling is wrong by 10^12 while still being finite.
//      Test 4.

import { ethers } from "ethers";
import { pairedAmount, reserveRatio, trimAmount } from "./deposit";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const parseable = (value: string, decimals: number) => {
  try {
    ethers.parseUnits(value, decimals);
    return true;
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------------ 1 -- */
/* trimAmount. The regression the second case pins: stripping /\.?0+$/ from a
   string with no decimal point at all turns "100" into "1". */
check("a whole number keeps its zeros", trimAmount(100, 6) === "100");
check("1000 is not 1", trimAmount(1000, 18) === "1000");
check("a trailing zero goes", trimAmount(1.2, 18) === "1.2");
check("only trailing zeros go", trimAmount(1.02, 18) === "1.02");
check("a third of a unit fits USDC", trimAmount(1 / 3, 6) === "0.333333");
check(
  "an 18-decimal token is capped at eight places",
  trimAmount(1 / 3, 18) === "0.33333333",
  trimAmount(1 / 3, 18),
);
check("below a token's resolution is empty, not zero", trimAmount(1e-9, 6) === "");
check("zero is empty", trimAmount(0, 6) === "");
check("negative is empty", trimAmount(-5, 6) === "");
check("NaN is empty", trimAmount(NaN, 6) === "");
check("Infinity is empty", trimAmount(Infinity, 18) === "");
for (const [n, d] of [
  [1 / 3, 6],
  [1 / 7, 18],
  [2 / 3, 8],
  [1234.56789, 6],
] as const) {
  check(
    `trimAmount(${n}, ${d}) is parseable`,
    parseable(trimAmount(n, d), d),
    trimAmount(n, d),
  );
}

/* ------------------------------------------------------------------ 2 -- */
/* pairedAmount. `ratio` is token1 per token0, so typing into leg 0 multiplies
   and typing into leg 1 divides. Swap those and a 3000 WETH/USDC pool asks for
   9,000,000 USDC beside one WETH. */
check(
  "typing token0 multiplies by the ratio",
  pairedAmount({ value: "2", from: "0", ratio: 3000, decimals: 6 }) === "6000",
);
check(
  "typing token1 divides by the ratio",
  pairedAmount({ value: "6000", from: "1", ratio: 3000, decimals: 18 }) === "2",
);
check(
  "the two directions round-trip",
  pairedAmount({
    value: pairedAmount({ value: "1", from: "0", ratio: 0.9994, decimals: 6 }),
    from: "1",
    ratio: 0.9994,
    decimals: 6,
  }) === "1",
);
check(
  "a ratio of zero fills nothing",
  pairedAmount({ value: "1", from: "0", ratio: 0, decimals: 6 }) === "",
);
check(
  "an infinite ratio fills nothing",
  pairedAmount({ value: "1", from: "0", ratio: Infinity, decimals: 6 }) === "",
);
check(
  "no ratio fills nothing",
  pairedAmount({ value: "1", from: "0", ratio: null, decimals: 6 }) === "",
);
check(
  "an empty box pairs with an empty box",
  pairedAmount({ value: "", from: "0", ratio: 2, decimals: 6 }) === "",
);
check(
  "a typed zero pairs with nothing",
  pairedAmount({ value: "0", from: "0", ratio: 2, decimals: 6 }) === "",
);
check(
  "a half-typed decimal point is not NaN",
  pairedAmount({ value: ".", from: "0", ratio: 2, decimals: 6 }) === "",
);

/* ------------------------------------------------------------------ 3 -- */
/* The awkward real case: an odd ratio into a 6-decimal token. */
const odd = pairedAmount({ value: "1", from: "0", ratio: 1 / 3, decimals: 6 });
check("an odd ratio is truncated to the token", odd === "0.333333", odd);
check("and is parseable", parseable(odd, 6));

/* ------------------------------------------------------------------ 4 -- */
/* reserveRatio, on the pair the decimals bite hardest: 1 WETH against 3000 USDC
   is a ratio of 3000, and the raw reserves differ by 10^12 before scaling. */
const ONE_WETH = ethers.parseUnits("1", 18).toString();
const USDC_3000 = ethers.parseUnits("3000", 6).toString();
const ratio = reserveRatio({
  reserve0: ONE_WETH,
  reserve1: USDC_3000,
  decimals0: 18,
  decimals1: 6,
});
check("mixed decimals scale before dividing", ratio === 3000, String(ratio));
const inverted = reserveRatio({
  reserve0: USDC_3000,
  reserve1: ONE_WETH,
  decimals0: 6,
  decimals1: 18,
});
check(
  "the other way round is the reciprocal",
  inverted !== null && Math.abs(inverted - 1 / 3000) < 1e-15,
  String(inverted),
);
check(
  "an empty pair has no ratio",
  reserveRatio({
    reserve0: "0",
    reserve1: "0",
    decimals0: 18,
    decimals1: 6,
  }) === null,
);
check(
  "one empty side has no ratio",
  reserveRatio({
    reserve0: ONE_WETH,
    reserve1: "0",
    decimals0: 18,
    decimals1: 6,
  }) === null,
);
check(
  "unparseable reserves have no ratio",
  reserveRatio({
    reserve0: "not a number",
    reserve1: "1",
    decimals0: 18,
    decimals1: 6,
  }) === null,
);
check(
  "numeric reserves are accepted as well as strings",
  reserveRatio({
    reserve0: 1000000,
    reserve1: 2000000,
    decimals0: 6,
    decimals1: 6,
  }) === 2,
);

/* ------------------------------------------------------------------ 5 -- */
/* The float derivation against the router's own integer quote.
 *
 * `_addLiquidity` computes `amountB = amountA * reserveB / reserveA` in uint256
 * and then requires the caller's minimum to be at or below it. The modal derives
 * the same number in float64 and floors it by 0.5%, so what has to hold is that
 * the float answer is nowhere near half a percent away from the integer one — not
 * that it is exact. Checked across three decimal pairings and four sizes.
 */
const quoteExact = (
  amountA: string,
  decA: number,
  decB: number,
  reserveA: string,
  reserveB: string,
) =>
  (ethers.parseUnits(amountA, decA) * BigInt(reserveB)) / BigInt(reserveA);

for (const [decA, decB, ra, rb] of [
  [18, 6, ethers.parseUnits("12.5", 18).toString(), ethers.parseUnits("37500", 6).toString()],
  [6, 6, ethers.parseUnits("1000000", 6).toString(), ethers.parseUnits("999123.456789", 6).toString()],
  [18, 18, ethers.parseUnits("7777.7777", 18).toString(), ethers.parseUnits("1.3", 18).toString()],
] as const) {
  const r = reserveRatio({
    reserve0: ra,
    reserve1: rb,
    decimals0: decA,
    decimals1: decB,
  });
  for (const amount of ["0.01", "1", "137.5", "999"]) {
    const derived = pairedAmount({
      value: amount,
      from: "0",
      ratio: r,
      decimals: decB,
    });
    const exact = quoteExact(amount, decA, decB, ra, rb);
    const mine = ethers.parseUnits(derived || "0", decB);
    /* Relative distance in bps, against the exact quote. Truncation to the
       token's decimals is a real and one-sided loss, so this is allowed to be
       under rather than only close. */
    const diff = exact > mine ? exact - mine : mine - exact;
    const withinHalfPct = exact === BigInt(0) || diff * BigInt(200) <= exact;
    check(
      `${amount} at ${decA}/${decB} lands inside the slippage floor`,
      withinHalfPct,
      `derived ${derived} vs exact ${exact}`,
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
