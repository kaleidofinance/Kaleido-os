/*
 * Checks on V3 uncollected-fee reconstruction. Run with `npm run test:fees`.
 *
 * There is no on-chain fixture to diff against, so every number below is either
 * hand-computable from the pool's own formula (chosen so the Q128 scale divides
 * out to a round figure) or — the check this module exists for — the wraparound
 * case a float implementation gets arbitrarily wrong. The accumulators are
 * uint256 values DESIGNED to overflow; the one property no double can honour is
 * that `inside - insideLast` stays correct when `insideLast` is numerically the
 * larger of the two. That case is asserted explicitly.
 */
import {
  uncollectedFees,
  feeAmountToNumber,
  _feeGrowthInside,
  _Q128,
  _MASK256,
  type FeeGrowthSnapshot,
} from "./feeGrowth.ts";

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

const Q = _Q128; // 2^128, the fee-growth scale

/* A range around parity, price sitting inside it. */
const IN_RANGE = { tickLower: -100, tickUpper: 100, tickCurrent: 0 };

/** One token's snapshot at N units of global growth, with the two ticks' outside. */
const snap = (global: bigint, outLower: bigint, outUpper: bigint): FeeGrowthSnapshot => ({
  feeGrowthGlobalX128: global,
  feeGrowthOutsideLowerX128: outLower,
  feeGrowthOutsideUpperX128: outUpper,
});

console.log("\n— feeGrowthInside picks the right branch —");
{
  const global = 10n * Q;
  const outLower = 2n * Q;
  const outUpper = 3n * Q;

  /* In range: inside = global − below(=outLower) − above(=outUpper). */
  const inside = _feeGrowthInside(-100, 100, 0, global, outLower, outUpper);
  check("in range subtracts both ticks' outside", inside === 5n * Q, String(inside / Q));

  /* Above the range (tickCurrent ≥ upper): below flips to outLower, above flips
     to global − outUpper, so inside = outUpper − outLower. */
  const above = _feeGrowthInside(-100, 100, 200, global, outLower, outUpper);
  check("above the range flips the upper term", above === Q, String(above / Q));

  /* Below the range (tickCurrent < lower): inside = outLower − outUpper, which is
     negative here and so wraps — the modulus is doing its job. */
  const below = _feeGrowthInside(-100, 100, -200, global, outLower, outUpper);
  check(
    "below the range flips the lower term and wraps",
    below === (_MASK256 + 1n - Q),
    String(below),
  );
}

console.log("\n— fees earned since the checkpoint —");
{
  /* inside = 10−2−3 = 5 (×Q). insideLast = 1×Q. delta = 4×Q. With L = 1000 the
     Q128 scale divides out to earned = 4000, plus the 500 already owed. */
  const token = snap(10n * Q, 2n * Q, 3n * Q);
  const fees = uncollectedFees({
    ...IN_RANGE,
    liquidity: 1000n,
    feeGrowthInside0LastX128: 1n * Q,
    feeGrowthInside1LastX128: 1n * Q,
    tokensOwed0: 500n,
    tokensOwed1: 500n,
    token0: token,
    token1: token,
  });
  check("earned + owed, both tokens", fees !== null);
  check("amount0 = 4000 earned + 500 owed", fees?.amount0 === 4500n, String(fees?.amount0));
  check("amount1 matches its own snapshot", fees?.amount1 === 4500n, String(fees?.amount1));
}

console.log("\n— THE WRAPAROUND: insideLast larger than inside —");
{
  /* Make inside evaluate to 0 (global = outLower + outUpper) and set the
     checkpoint to −1×Q held as its uint256 representation (2^256 − Q). A correct
     subtraction gives delta = +Q → earned = 1×L. A naive (inside − insideLast)
     in a signed/float world gives a vast NEGATIVE number: the whole point. */
  const insideLast = _MASK256 + 1n - Q; // 2^256 − Q, i.e. −Q mod 2^256
  const token = snap(5n * Q, 2n * Q, 3n * Q); // inside = 0
  const fees = uncollectedFees({
    ...IN_RANGE,
    liquidity: 777n,
    feeGrowthInside0LastX128: insideLast,
    feeGrowthInside1LastX128: insideLast,
    tokensOwed0: 0n,
    tokensOwed1: 0n,
    token0: token,
    token1: token,
  });
  check(
    "a wrapped checkpoint yields exactly 1×L, not garbage",
    fees?.amount0 === 777n,
    String(fees?.amount0),
  );
  check("never negative", fees !== null && fees.amount0 >= 0n && fees.amount1 >= 0n);
}

console.log("\n— zero liquidity is a withdrawn position, not an error —");
{
  const token = snap(10n * Q, 2n * Q, 3n * Q);
  const fees = uncollectedFees({
    ...IN_RANGE,
    liquidity: 0n,
    feeGrowthInside0LastX128: 1n * Q,
    feeGrowthInside1LastX128: 1n * Q,
    /* Fees can still be sitting owed from before the withdrawal. */
    tokensOwed0: 42n,
    tokensOwed1: 7n,
    token0: token,
    token1: token,
  });
  check("measures, does not return null", fees !== null);
  check(
    "and reports just the owed checkpoint",
    fees?.amount0 === 42n && fees?.amount1 === 7n,
    `${fees?.amount0}, ${fees?.amount1}`,
  );
}

console.log("\n— what must return null —");
{
  const token = snap(10n * Q, 2n * Q, 3n * Q);
  const good = {
    ...IN_RANGE,
    liquidity: 1000n,
    feeGrowthInside0LastX128: 0n,
    feeGrowthInside1LastX128: 0n,
    tokensOwed0: 0n,
    tokensOwed1: 0n,
    token0: token,
    token1: token,
  };
  check("a sound input is not null", uncollectedFees(good) !== null);
  check("an inverted range", uncollectedFees({ ...good, tickLower: 100, tickUpper: -100 }) === null);
  check("a zero-width range", uncollectedFees({ ...good, tickLower: 0, tickUpper: 0 }) === null);
  check("negative liquidity", uncollectedFees({ ...good, liquidity: -1n }) === null);
  check("a non-integer lower tick", uncollectedFees({ ...good, tickLower: 1.5 }) === null);
  check("a NaN current tick", uncollectedFees({ ...good, tickCurrent: NaN }) === null);
}

console.log("\n— raw base units to a display float —");
{
  check("whole units at 0 decimals", feeAmountToNumber(4500n, 0) === 4500);
  check("1.5 at 6 decimals", feeAmountToNumber(1_500_000n, 6) === 1.5);
  check("one whole token at 18 decimals", feeAmountToNumber(10n ** 18n, 18) === 1);
  check("zero is zero", feeAmountToNumber(0n, 18) === 0);

  /* A uint128 max fee amount is the largest a collect could ever pay; it must
     still land as a finite double, not Infinity or NaN. */
  const u128max = (1n << 128n) - 1n;
  const big = feeAmountToNumber(u128max, 18);
  check("uint128 max stays finite", Number.isFinite(big) && big > 0);

  check("negative decimals are rejected", Number.isNaN(feeAmountToNumber(1n, -1)));
  check("implausible decimals are rejected", Number.isNaN(feeAmountToNumber(1n, 40)));
  check("fractional decimals are rejected", Number.isNaN(feeAmountToNumber(1n, 6.5)));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
