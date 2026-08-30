// Checks on V3 position valuation. Run with plain node (tsx).
//
// This file has no on-chain fixture to compare against, so almost nothing below
// is a typed-in expected number. Each check is either an identity that holds for
// any correct implementation (a symmetric range holds equal raw amounts at
// parity; the two out-of-range cases mirror each other) or a cross-check against
// `getV3AmountRatio`, which is the deposit path's own independently written form
// of the same liquidity maths. A hand-computed expectation would be reproducing,
// by eye, the arithmetic this module exists to get right.
import { positionAmounts, positionValueUsd } from "./positionValue.ts";
import { getV3AmountRatio, MAX_TICK, MIN_TICK } from "../../constants/utils/v3Math.ts";

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const Q96 = 2 ** 96;
/** A sqrt price (token1 per token0, raw units) as the uint160 string slot0 gives. */
const x96 = (sqrtP) => BigInt(Math.round(sqrtP * Q96)).toString();
/** Relative closeness, because every figure here is double arithmetic. */
const near = (a, b, tol = 1e-9) =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/* A range symmetric about parity: sqrtL * sqrtU === 1, which is what makes the
   identities below clean. 6000 is a multiple of every tick spacing this app
   offers, so it is a range that could actually be minted. */
const T = 6000;
const L = "1000000000000000000"; // 1e18, a plausible liquidity constant
const base = {
  tickLower: -T,
  tickUpper: T,
  liquidity: L,
  decimals0: 18,
  decimals1: 18,
};

console.log("\n— in range —");
{
  const at = positionAmounts({ ...base, sqrtPriceX96: x96(1) });
  check("a position at parity is measurable", at !== null);
  check(
    "and a range symmetric about parity holds equal amounts there",
    at !== null && near(at.amount0, at.amount1),
    at ? `${at.amount0} vs ${at.amount1}` : "",
  );
  check(
    "both sides are positive, not zero",
    at !== null && at.amount0 > 0 && at.amount1 > 0,
  );

  /* The independent check: `getV3AmountRatio` computes amount1/amount0 for a
     deposit from human prices, by a formula written for a different purpose. At
     18/18 decimals the human price is the raw price, so the two must agree. */
  const sqrtP = 1.1;
  const skewed = positionAmounts({ ...base, sqrtPriceX96: x96(sqrtP) });
  const ratio = getV3AmountRatio(
    sqrtP ** 2,
    1.0001 ** -T,
    1.0001 ** T,
    18,
    18,
  );
  check(
    "amount1/amount0 agrees with getV3AmountRatio off-parity",
    skewed !== null && near(skewed.amount1 / skewed.amount0, ratio, 1e-6),
    skewed ? `${skewed.amount1 / skewed.amount0} vs ${ratio}` : "",
  );
}

console.log("\n— out of range, where the position is one-sided —");
{
  const above = positionAmounts({ ...base, sqrtPriceX96: x96(2) });
  check("above the range there is no token0 left", above !== null && above.amount0 === 0);
  check("and token1 is all of it", above !== null && above.amount1 > 0);

  const below = positionAmounts({ ...base, sqrtPriceX96: x96(0.5) });
  check("below the range there is no token1 left", below !== null && below.amount1 === 0);
  check("and token0 is all of it", below !== null && below.amount0 > 0);

  /* sqrtL * sqrtU === 1 for this range, so the fully-converted amount is the
     same number on either side. A sign error or a swapped bound breaks this. */
  check(
    "the two fully-converted sides mirror each other",
    above !== null && below !== null && near(above.amount1, below.amount0),
    above && below ? `${above.amount1} vs ${below.amount0}` : "",
  );

  /* Clamping, not extrapolating: pushing the price further out must not change
     the amounts, because the pool converted the position at the boundary. */
  const farAbove = positionAmounts({ ...base, sqrtPriceX96: x96(50) });
  check(
    "and pushing price further out changes nothing",
    above !== null && farAbove !== null && near(above.amount1, farAbove.amount1),
  );
}

console.log("\n— decimals —");
{
  const wide = positionAmounts({ ...base, sqrtPriceX96: x96(1) });
  const six = positionAmounts({ ...base, sqrtPriceX96: x96(1), decimals0: 6 });
  check(
    "a 6-decimal token0 scales by 1e12 against an 18-decimal one",
    wide !== null && six !== null && near(six.amount0, wide.amount0 * 1e12),
  );
  check(
    "and token1 is untouched by token0's decimals",
    wide !== null && six !== null && near(six.amount1, wide.amount1),
  );
}

console.log("\n— an empty position is not an unmeasurable one —");
{
  const empty = positionAmounts({ ...base, sqrtPriceX96: x96(1), liquidity: "0" });
  check("zero liquidity measures as zero, not null", empty !== null);
  check(
    "and reports both sides empty",
    empty !== null && empty.amount0 === 0 && empty.amount1 === 0,
  );
}

console.log("\n— what must return null rather than a number —");
{
  const cases = [
    ["an unread sqrtPriceX96", { sqrtPriceX96: null }],
    ["an empty sqrtPriceX96 string", { sqrtPriceX96: "" }],
    ["a zero price", { sqrtPriceX96: "0" }],
    ["a non-numeric price", { sqrtPriceX96: "not-a-number" }],
    ["an empty liquidity string", { sqrtPriceX96: x96(1), liquidity: "" }],
    ["a negative liquidity", { sqrtPriceX96: x96(1), liquidity: "-1" }],
    ["an inverted range", { sqrtPriceX96: x96(1), tickLower: T, tickUpper: -T }],
    ["a zero-width range", { sqrtPriceX96: x96(1), tickLower: 0, tickUpper: 0 }],
    [
      "a tickLower past the protocol minimum",
      { sqrtPriceX96: x96(1), tickLower: MIN_TICK - 1 },
    ],
    [
      "a tickUpper past the protocol maximum",
      { sqrtPriceX96: x96(1), tickUpper: MAX_TICK + 1 },
    ],
    ["implausible decimals", { sqrtPriceX96: x96(1), decimals1: 40 }],
    ["fractional decimals", { sqrtPriceX96: x96(1), decimals0: 6.5 }],
    ["NaN ticks", { sqrtPriceX96: x96(1), tickLower: NaN }],
  ];
  for (const [name, patch] of cases) {
    check(name, positionAmounts({ ...base, ...patch }) === null);
  }

  /* The widest mintable range still has to produce a number — it is the default
     a "full range" deposit lands on, so returning null for it would leave the
     most common position on the page unmeasurable. */
  const full = positionAmounts({
    ...base,
    sqrtPriceX96: x96(1),
    tickLower: MIN_TICK + 8,
    tickUpper: MAX_TICK - 8,
  });
  check(
    "but a near-full range is measurable",
    full !== null && full.amount0 > 0 && full.amount1 > 0,
    full ? `${full.amount0}, ${full.amount1}` : "null",
  );
}

console.log("\n— valuing it —");
{
  const amounts = { amount0: 2, amount1: 300 };
  check("both legs priced sums them", positionValueUsd(amounts, 1000, 1) === 2300);
  check(
    "an unpriced leg that holds something is unknowable",
    positionValueUsd(amounts, 1000, null) === null,
  );
  check(
    "a zero price counts as no price",
    positionValueUsd(amounts, 0, 1) === null,
  );

  /* The case this signature exists for: a range that has moved fully into the
     priced token is worth a knowable amount even when the other leg has no feed
     at all — USDe has none, and KLD has no market before TGE. */
  check(
    "an unpriced leg holding nothing does not block the total",
    positionValueUsd({ amount0: 0, amount1: 300 }, null, 1) === 300,
  );
  check(
    "and the same on the other side",
    positionValueUsd({ amount0: 2, amount1: 0 }, 1000, null) === 2000,
  );
  check("an empty position is worth zero", positionValueUsd({ amount0: 0, amount1: 0 }, null, null) === 0);
  check("unmeasurable amounts stay unmeasurable", positionValueUsd(null, 1, 1) === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
