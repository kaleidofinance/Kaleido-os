// Checks on the V2 execution maths behind the pool detail page's depth curve.
// Run with `npx tsx "src/app/(app)/pool/poolCurve.test.ts"`.
//
// A depth curve fails by looking plausible. It is a smooth line either way, so
// nothing about the rendered shape tells you whether the numbers under it match
// what the pair would actually execute. That makes this suite, not the screen,
// the thing that decides whether the chart is honest.
//
// What is under test, in order of how badly it fails when wrong:
//
//   1. Transcription. `amountOut` claims to reproduce
//      KaleidoSwapLibrary.sol:53-60 including its integer truncation. The first
//      block below pins literal outputs computed by hand from that formula, so
//      the assertion is against the contract's arithmetic rather than against a
//      second copy of the code under test. A float implementation passes a
//      "looks about right" check and fails these.
//   2. The fee actually being read. A curve that ignores `feeBps` is the
//      router's own bug (KaleidoSwapRouter.sol:455 hardcodes 30), and it is
//      invisible on screen because 5 bps and 30 bps draw nearly the same line.
//      Test 6 is the one that catches it.
//   3. Mixed decimals. WETH/USDC is 18/6, and getting the scaling wrong moves
//      the whole curve by 10^12 while still drawing a plausible-looking sweep.
//   4. Degenerate pairs returning null rather than NaN or Infinity, since a NaN
//      reaches the SVG as a broken path attribute and renders as nothing.

import {
  amountOut,
  impactCurve,
  poolCurves,
  type CurvePoint,
} from "./poolCurve";

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

/* ------------------------------------------------------------------ 1 -- */
/* Literal outputs, worked through KaleidoSwapLibrary.sol:53-60 by hand:
 *
 *   amountInWithFee = amountIn * (10000 - fee)
 *   amountOut       = (amountInWithFee * reserveOut)
 *                     / (reserveIn * 10000 + amountInWithFee)
 *
 * With reserveIn = reserveOut = 1_000_000 and amountIn = 100_000:
 *
 *   fee 30 -> 997_000_000 * 1e6 / (1e10 + 997_000_000)
 *          =  997_000_000_000_000 / 10_997_000_000        = 90_661 (rem 982_000_000)
 *   fee  0 -> 1e9 * 1e6 / (1e10 + 1e9)
 *          =  1_000_000_000_000_000 / 11_000_000_000       = 90_909 (rem 1_000_000_000)
 *   fee  5 -> 999_500_000 * 1e6 / (1e10 + 999_500_000)
 *          =  999_500_000_000_000 / 10_999_500_000         = 90_867 (rem 8_433_500_000)
 *
 * Each remainder is smaller than its divisor, which is the check that the floor
 * is on the right side of the boundary.
 */
console.log("\ntranscription of KaleidoSwapLibrary.getAmountOut");
const X = 1_000_000n;
const IN = 100_000n;
check(
  "fee 30 truncates to 90_661",
  amountOut(IN, X, X, 30) === 90_661n,
  String(amountOut(IN, X, X, 30)),
);
check(
  "fee 0 truncates to 90_909",
  amountOut(IN, X, X, 0) === 90_909n,
  String(amountOut(IN, X, X, 0)),
);
check(
  "fee 5 truncates to 90_867",
  amountOut(IN, X, X, 5) === 90_867n,
  String(amountOut(IN, X, X, 5)),
);

/* The result is a bigint, not a number. A float return would still compare
   equal above for these magnitudes, so this is the assertion that pins it. */
check("returns bigint", typeof amountOut(IN, X, X, 30) === "bigint");

/* ------------------------------------------------------------------ 2 -- */
console.log("\nfee 0 reduces to the closed form y*dx/(x+dx)");
const TABLE: Array<[bigint, bigint, bigint]> = [
  [1n, 1_000_000n, 1_000_000n],
  [7n, 3n, 11n],
  [12_345n, 999_983n, 1_000_003n],
  [10n ** 18n, 615n * 10n ** 18n, 2_091_000n * 10n ** 6n],
  [10n ** 6n, 2_091_000n * 10n ** 6n, 615n * 10n ** 18n],
];
let closedFormOk = true;
for (const [dx, x, y] of TABLE) {
  const expected = (y * dx) / (x + dx);
  if (amountOut(dx, x, y, 0) !== expected) {
    closedFormOk = false;
    console.log(
      `       dx=${dx} x=${x} y=${y} got ${amountOut(dx, x, y, 0)} want ${expected}`,
    );
  }
}
check(`closed form holds across ${TABLE.length} cases`, closedFormOk);

/* ------------------------------------------------------------------ 3 -- */
/* The invariant the pair itself enforces (KaleidoSwapPair.sol:243-247): k may
   grow — truncation and the fee both leave dust behind — but it must never
   shrink, in any direction, at any fee. A sign error or an inverted fee term
   shows up here and almost nowhere else. */
console.log("\nk never decreases");
let kOk = true;
for (const [dx, x, y] of TABLE) {
  for (const fee of [0, 5, 30, 100]) {
    const out = amountOut(dx, x, y, fee);
    if (out === null) continue;
    if ((x + dx) * (y - out) < x * y) {
      kOk = false;
      console.log(`       k shrank: dx=${dx} x=${x} y=${y} fee=${fee}`);
    }
    /* And the pool can never pay out more than it holds. */
    if (out >= y) {
      kOk = false;
      console.log(
        `       drained: dx=${dx} x=${x} y=${y} fee=${fee} out=${out}`,
      );
    }
  }
}
check("k monotonic and pool never drained", kOk);

/* ------------------------------------------------------------------ 4 -- */
console.log("\nguards return null, never NaN or Infinity");
check("zero input", amountOut(0n, X, X, 30) === null);
check("negative input", amountOut(-1n, X, X, 30) === null);
check("empty input leg", amountOut(IN, 0n, X, 30) === null);
check("empty output leg", amountOut(IN, X, 0n, 30) === null);
check("fee at denominator", amountOut(IN, X, X, 10_000) === null);
check("fee above denominator", amountOut(IN, X, X, 10_001) === null);
check("negative fee", amountOut(IN, X, X, -1) === null);
check(
  "empty pair yields no curve",
  impactCurve(
    { reserveIn: 0n, reserveOut: X, decimalsIn: 18, decimalsOut: 18 },
    30,
  ).length === 0,
);

/* ------------------------------------------------------------------ 5 -- */
/* Curve shape. The two facts a reader relies on: cost rises with size, and it
   does not start at zero — a 0.3% pair charges 0.3% on a dust trade. An
   implementation that reports only the reserve move would start at zero here
   and understate every row by the fee. */
console.log("\ncurve shape");
const EIGHTEEN = { decimalsIn: 18, decimalsOut: 18 };
const flat = impactCurve(
  {
    reserveIn: 1_000_000n * 10n ** 18n,
    reserveOut: 1_000_000n * 10n ** 18n,
    ...EIGHTEEN,
  },
  30,
);
check("curve is populated", flat.length > 30, `${flat.length} points`);

const monotonic = (pts: CurvePoint[], key: "costPct" | "impactPct") =>
  pts.every((p, i) => i === 0 || p[key] >= pts[i - 1]![key]);
check("cost rises with size", monotonic(flat, "costPct"));
check("impact rises with size", monotonic(flat, "impactPct"));

const first = flat[0]!;
const last = flat[flat.length - 1]!;
/* At the smallest sample the curve term is negligible, so cost is the fee and
   almost nothing else: 0.3%, within a hundredth of a point. */
check(
  "cost tends to the fee, not to zero",
  Math.abs(first.costPct - 0.3) < 0.01,
  `${first.costPct}`,
);
check("impact tends to zero", first.impactPct < 0.01, `${first.impactPct}`);
check("cost stays below 100%", last.costPct < 100, `${last.costPct}`);
/* Half the reserve against a constant product is a ~33% move before fees. */
check(
  "half the reserve costs a third",
  last.impactPct > 30 && last.impactPct < 40,
  `${last.impactPct}`,
);
check(
  "cost is never below impact",
  flat.every((p) => p.costPct >= p.impactPct),
);
check(
  "no NaN anywhere in the curve",
  flat.every(
    (p) =>
      Number.isFinite(p.costPct) &&
      Number.isFinite(p.impactPct) &&
      Number.isFinite(p.amountIn) &&
      Number.isFinite(p.amountOut),
  ),
);

/* ------------------------------------------------------------------ 6 -- */
/* The assertion that catches someone reaching for the router's hardcoded 30.
   These two curves are visually near-identical, which is exactly why the check
   has to be numeric. */
console.log("\nthe fee is actually read");
const stable = impactCurve(
  {
    reserveIn: 1_000_000n * 10n ** 18n,
    reserveOut: 1_000_000n * 10n ** 18n,
    ...EIGHTEEN,
  },
  5,
);
check("5 bps differs from 30 bps", stable[0]!.costPct !== flat[0]!.costPct);
check(
  "5 bps is cheaper at every size",
  stable.every((p, i) => p.costPct < flat[i]!.costPct),
);
check(
  "5 bps starts at its own fee",
  Math.abs(stable[0]!.costPct - 0.05) < 0.01,
  `${stable[0]!.costPct}`,
);
/* The fee changes cost but not the reserve move: impact is a property of the
   curve, so it must be the same in both. */
check(
  "impact is fee-independent",
  stable.every((p, i) => Math.abs(p.impactPct - flat[i]!.impactPct) < 1e-9),
);

/* ------------------------------------------------------------------ 7 -- */
/* Mixed decimals, the case that breaks a naive implementation while still
   drawing a believable line. WETH/USDC at 615 / 2,091,000 — spot 3400.
   Selling 1% of the WETH leg (6.15 WETH):
     out(no fee) = 2_091_000 * 6.15 / 621.15 ~= 20_703.4 USDC
     effective   ~= 3365.6, against spot 3400 -> ~1.01% impact
     with 30 bps ~= 1.31% cost
   So both must land in a tight band around one percent, not 10^12 away. */
console.log("\nmixed decimals (18 / 6)");
const R0 = 615n * 10n ** 18n;
const R1 = 2_091_000n * 10n ** 6n;
const onePct = R0 / 100n;
const outRaw = amountOut(onePct, R0, R1, 30);
const outUsdc = Number(outRaw) / 1e6;
check(
  "1% of WETH returns ~20.6K USDC",
  outUsdc > 20_000 && outUsdc < 21_000,
  `${outUsdc}`,
);

const spot = 2_091_000 / 615;
const effective = outUsdc / 6.15;
const costPct = (1 - effective / spot) * 100;
check("cost is ~1.3%, not 10^12", costPct > 1.0 && costPct < 1.7, `${costPct}`);

const both = poolCurves(R0, R1, 18, 6, 30);
check(
  "both directions populated",
  both.sell0.length > 30 && both.sell1.length > 30,
);
/* Same constant product read from either end, so the same fractional trade
   costs the same either way. This is the check that catches decimals swapped
   between the two sides. */
check(
  "the curve is symmetric in fractional terms",
  both.sell0.every(
    (p, i) => Math.abs(p.costPct - both.sell1[i]!.costPct) < 0.01,
  ),
);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
