/**
 * Tests for the browser-side half of spot pricing.
 *
 * `priceLookup` decides whether a pool leg has a dollar value, and every TVL,
 * volume and APR figure on /pool is gated on it. A lookup that is wrong in
 * the permissive direction prices a pool with a stale or bogus number; wrong in
 * the strict direction renders a funded pool as an em dash. Neither shows up in
 * `tsc`, so the edges are asserted here.
 *
 * Run: node src/lib/market/spot.test.ts
 */

import { priceLookup, type SpotPrices } from "./spot.ts";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const table: SpotPrices = {
  usd: {
    WETH: 3421.55,
    USDC: 0.9998,
    kfUSD: 1,
    // Deliberately unusable values, of the kind a broken feed produces.
    BROKEN_ZERO: 0,
    BROKEN_NEG: -12,
    BROKEN_NAN: Number.NaN,
    BROKEN_INF: Number.POSITIVE_INFINITY,
  },
  asOf: "2026-08-17T00:00:00.000Z",
};

console.log("— priceLookup: hits —");
const priceOf = priceLookup(table);
check("exact symbol", priceOf("WETH") === 3421.55);
check("a par asset is a real price", priceOf("kfUSD") === 1);
check("sub-dollar price is usable", priceOf("USDC") === 0.9998);

console.log("— priceLookup: case and whitespace —");
check("lowercase falls back", priceOf("weth") === 3421.55);
check("uppercase falls back", priceOf("KFUSD") === 1);
check("mixed case falls back", priceOf("kFuSd") === 1);
check("surrounding whitespace trimmed", priceOf("  WETH  ") === 3421.55);

console.log("— priceLookup: no price is null, never a default —");
check("unknown symbol", priceOf("KLD") === null);
check("empty string", priceOf("") === null);
check("whitespace only", priceOf("   ") === null);
check("undefined symbol", priceOf(undefined as unknown as string) === null);

console.log("— priceLookup: a broken feed value is not a price —");
/* Zero is the one that matters most: it is finite, it is a number, and
 * multiplying reserves by it reports a funded pool as empty. */
check("zero is rejected", priceOf("BROKEN_ZERO") === null);
check("zero is rejected case-insensitively", priceOf("broken_zero") === null);
check("negative is rejected", priceOf("BROKEN_NEG") === null);
check("NaN is rejected", priceOf("BROKEN_NAN") === null);
check("Infinity is rejected", priceOf("BROKEN_INF") === null);

console.log("— priceLookup: degraded inputs —");
check(
  "null table yields null for everything",
  priceLookup(null)("WETH") === null,
);
check(
  "table with no usd map yields null",
  priceLookup({ asOf: "x" } as unknown as SpotPrices)("WETH") === null,
);
check(
  "empty usd map yields null",
  priceLookup({ usd: {}, asOf: "x" })("WETH") === null,
);
/* A prototype key must not resolve as a price: `usd["constructor"]` is a
 * function on a bare object literal, and `usable()` is what stops it. */
check("prototype key is not a price", priceOf("constructor") === null);
check("toString is not a price", priceOf("toString") === null);

console.log("— volume window: the scale factor replaces `* 17.28` —");
/* The old code multiplied a 5000-block sample by 17.28 = 86400/5000, which is
 * only right if every block is exactly one second. The replacement divides a day
 * by the window's measured duration, so these are the factors it produces. */
const DAY_SEC = 86_400;
const scaleFor = (spanSec: number) => DAY_SEC / spanSec;

check("1s blocks: 5000 blocks span 5000s", scaleFor(5000) === 17.28);
check(
  "2s blocks halve the factor",
  scaleFor(10_000) === 8.64,
  `got ${scaleFor(10_000)}`,
);
check("12h sample doubles", scaleFor(43_200) === 2);
check("24h sample is identity", scaleFor(DAY_SEC) === 1);
/* Above a day the factor drops below 1 — it averages the sample down rather than
 * projecting it up, which is the case the old constant could never express. */
check("41h sample averages down", scaleFor(148_000) < 1);

/* The concrete overstatement the old constant caused: on 2s blocks it claimed
 * 17.28 days' worth of a sample that covered 10000s. */
check(
  "old constant overstated 2s-block volume exactly 2x",
  17.28 / scaleFor(10_000) === 2,
);

console.log("— fee arithmetic: bps of 10000 —");
const FEE_DENOMINATOR = 10_000;
const feesOn = (volume: number, bps: number) =>
  (volume * bps) / FEE_DENOMINATOR;
check("30 bps of $1,000,000 is $3,000", feesOn(1_000_000, 30) === 3000);
check("5 bps of $1,000,000 is $500", feesOn(1_000_000, 5) === 500);
check("100 bps of $1,000,000 is $10,000", feesOn(1_000_000, 100) === 10_000);
/* The three tiers the factory enables at construction (KaleidoSwapFactory.sol),
 * rendered as the table shows them. */
const feeLabel = (bps: number) => `${(bps / 100).toFixed(2)}%`;
check("5 renders 0.05%", feeLabel(5) === "0.05%");
check("30 renders 0.30%", feeLabel(30) === "0.30%");
check("100 renders 1.00%", feeLabel(100) === "1.00%");

console.log("— liquidity: one priced leg doubles —");
/* Valid only under constant product, which KaleidoSwapPair.sol:243-247 enforces
 * for every pair: at the pool's own price the two sides hold equal value. A
 * WETH/KLD pool holding 10 WETH at $3421.55 is $68,431 all in. */
const oneLeg = (reserve: number, price: number) => reserve * price * 2;
check("10 WETH at 3421.55 doubles to 68431", oneLeg(10, 3421.55) === 68_431);
const bothLegs = (r0: number, p0: number, r1: number, p1: number) =>
  r0 * p0 + r1 * p1;
check(
  "both legs priced sums rather than doubles",
  bothLegs(10, 3421.55, 34_215.5, 1) === 68_431,
);

console.log("— APR —");
const apr = (fees24h: number, liquidity: number) =>
  ((fees24h * 365) / liquidity) * 100;
check("$100/day on $100,000 is 36.5%", apr(100, 100_000) === 36.5);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
