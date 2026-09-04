// Checks on the V3 tick math. Run with plain node.
//
// Two frames of reference meet in this module — the pool's address-sorted order
// and whatever order the UI shows the pair in — and every bug it has produced
// came from applying half a conversion. These pin the halves to each other, plus
// the two arithmetic faults that shipped: a full range at ticks no fee tier can
// accept, and a snap that landed a whole spacing low below parity. Plus the one
// that shipped to a screen: a price read off a tick that was never a price.
import {
  TICK_SPACINGS,
  MIN_TICK,
  MAX_TICK,
  poolOrderInverted,
  invertTickRange,
  fullRangeTicks,
  priceToTick,
  tickToPrice,
  nearestUsableTick,
  isTickPinned,
} from "./v3Math.ts";

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

/** Relative comparison — tick math is logarithmic, so absolute epsilons lie. */
const near = (a, b, tol) => Math.abs(a - b) <= Math.abs(b) * tol;

const SPACINGS = Object.values(TICK_SPACINGS);
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

console.log("\n— pool order is the pair sorted by address —");
{
  check(
    "a pair already in address order is not inverted",
    !poolOrderInverted(A, B),
  );
  check("the same pair named backwards is", poolOrderInverted(B, A));
  /*
   * The factory compares addresses as numbers. Compared as raw strings, every
   * uppercase hex digit sorts below every lowercase one, so a checksummed
   * spelling flips the answer: "0xBB…" < "0xaa…" by ASCII but 0xbb > 0xaa by
   * value. A wrong answer here doesn't throw — it mints a mirrored range.
   */
  check(
    "case folding, so a checksummed address sorts by value not by ASCII",
    poolOrderInverted(B.toUpperCase(), A) &&
      !poolOrderInverted(A.toUpperCase(), B),
    `${poolOrderInverted(B.toUpperCase(), A)} ${poolOrderInverted(A.toUpperCase(), B)}`,
  );
  check("a token never sorts against itself", !poolOrderInverted(A, A));
}

console.log("\n— crossing frames negates the tick and swaps the bounds —");
{
  const r = invertTickRange(-6000, 12000);
  check(
    "both bounds negate and trade places",
    r.tickLower === -12000 && r.tickUpper === 6000,
    JSON.stringify(r),
  );
  check("so the lower bound stays the lower one", r.tickLower < r.tickUpper);

  const back = invertTickRange(r.tickLower, r.tickUpper);
  check(
    "inverting twice is the identity",
    back.tickLower === -6000 && back.tickUpper === 12000,
    JSON.stringify(back),
  );

  // Why negation is the right operation: a tick is a logarithm, so flipping the
  // numerator and denominator flips its sign. Swapping the decimals with it is
  // the other half — that pair of moves is exactly what getCurrentTick undoes.
  const p = tickToPrice(6931, 18, 6);
  const inverse = tickToPrice(-6931, 6, 18);
  check(
    "the inverted tick prices the pair from the other side",
    near(inverse, 1 / p, 1e-9),
    `${inverse} vs ${1 / p}`,
  );

  /*
   * The user-visible claim: a range that brackets the market in the order the
   * UI labelled brackets the reciprocal once turned over. Half a conversion —
   * negating without swapping, or swapping without negating — puts the range
   * wholly on one side of the market, which mints and then earns nothing.
   */
  const lo = 1800;
  const hi = 2200;
  const userLower = nearestUsableTick(priceToTick(lo, 18, 6), 60);
  const userUpper = nearestUsableTick(priceToTick(hi, 18, 6), 60);
  check("the user-frame range is the right way up", userLower < userUpper);
  const pool = invertTickRange(userLower, userUpper);
  const poolLo = tickToPrice(pool.tickLower, 6, 18);
  const poolHi = tickToPrice(pool.tickUpper, 6, 18);
  check(
    "the pool-frame range brackets the reciprocal of the market price",
    poolLo < 1 / 2000 && 1 / 2000 < poolHi,
    `${poolLo} .. ${poolHi} around ${1 / 2000}`,
  );
  check(
    "and its edges are the reciprocals of the edges asked for",
    // Within a tick spacing: both bounds were snapped before inverting.
    near(poolLo, 1 / hi, 0.01) && near(poolHi, 1 / lo, 0.01),
    `${poolLo} vs ${1 / hi}, ${poolHi} vs ${1 / lo}`,
  );
}

console.log("\n— full range is aligned to the fee tier, not the raw bounds —");
{
  /*
   * The regression this function exists for: the page hardcoded ±887272, and
   * TickBitmap.flipTick requires tick % tickSpacing == 0 with no reason string.
   * A fresh position flips both ticks, so Full range reverted unexplained on
   * every tier the app offers.
   */
  check(
    "the raw bound divides no spacing the app offers",
    SPACINGS.filter((s) => s > 1).every((s) => MAX_TICK % s !== 0),
    SPACINGS.map((s) => `${s}:${MAX_TICK % s}`).join(" "),
  );

  for (const spacing of SPACINGS) {
    const { tickLower, tickUpper } = fullRangeTicks(spacing);
    check(
      `spacing ${spacing}: both bounds land on the grid`,
      tickLower % spacing === 0 && tickUpper % spacing === 0,
      `${tickLower} ${tickUpper}`,
    );
    check(
      `spacing ${spacing}: and inside what TickMath allows`,
      tickLower >= MIN_TICK && tickUpper <= MAX_TICK,
      `${tickLower} ${tickUpper}`,
    );
    check(
      `spacing ${spacing}: symmetric, and gives up under one spacing at each end`,
      tickLower === -tickUpper && MAX_TICK - tickUpper < spacing,
      `${tickUpper} vs ${MAX_TICK}`,
    );
  }

  check(
    "the 0.30% tier's widest range is ±887220",
    fullRangeTicks(60).tickUpper === 887220,
    String(fullRangeTicks(60).tickUpper),
  );
}

console.log("\n— snapping rounds to the nearest tick on both sides of zero —");
{
  // The shipped bug: floor with a sign branch rounded away from zero, so every
  // negative tick landed a whole spacing low and any range below parity slid
  // down — asymmetrically, when one bound was negative and the other wasn't.
  check(
    "a negative tick snaps to the nearer grid line, not the further one",
    nearestUsableTick(-100, 60) === -120,
    String(nearestUsableTick(-100, 60)),
  );
  check(
    "as the mirror of the positive case",
    nearestUsableTick(100, 60) === 120 &&
      nearestUsableTick(-5000, 60) === -nearestUsableTick(5000, 60),
    `${nearestUsableTick(100, 60)} ${nearestUsableTick(-5000, 60)}`,
  );
  check(
    "an aligned tick is left alone",
    nearestUsableTick(-1200, 60) === -1200 &&
      nearestUsableTick(1200, 60) === 1200,
  );
  check(
    "and no negative zero reaches a mint param",
    !Object.is(nearestUsableTick(-10, 60), -0),
    String(nearestUsableTick(-10, 60)),
  );

  for (const spacing of SPACINGS) {
    for (const tick of [
      -887272, -200003, -1999, -61, -1, 0, 1, 61, 1999, 200003, 887272,
    ]) {
      const snapped = nearestUsableTick(tick, spacing);
      check(
        `tick ${tick} at spacing ${spacing} stays on the grid and in range`,
        snapped % spacing === 0 && snapped >= MIN_TICK && snapped <= MAX_TICK,
        String(snapped),
      );
    }
  }

  // Clamping is the only case allowed to move more than half a spacing, and it
  // moves inward: MIN/MAX aren't on the grid, so rounding can overshoot them.
  const wide = [-887272, 887272];
  for (const spacing of SPACINGS) {
    for (const tick of [-200003, -1999, -61, 0, 61, 1999, 200003]) {
      const snapped = nearestUsableTick(tick, spacing);
      check(
        `tick ${tick} at spacing ${spacing} moves at most half a spacing`,
        Math.abs(snapped - tick) <= spacing / 2,
        `${snapped} - ${tick}`,
      );
    }
    for (const tick of wide) {
      const snapped = nearestUsableTick(tick, spacing);
      check(
        `the bound ${tick} at spacing ${spacing} clamps inward`,
        Math.abs(snapped) <= Math.abs(tick),
        String(snapped),
      );
    }
  }
}

console.log("\n— price and tick round trip —");
{
  for (const [price, d0, d1] of [
    [2, 18, 18],
    [0.5, 18, 18],
    [2500, 18, 6],
    [0.0004, 6, 18],
    [1, 18, 6],
  ]) {
    const back = tickToPrice(priceToTick(price, d0, d1), d0, d1);
    check(
      `${price} at ${d0}/${d1} decimals survives the trip`,
      // priceToTick floors, so the price returns up to one tick (1bp) low.
      near(back, price, 3e-4),
      `${back} vs ${price}`,
    );
  }

  check(
    "decimals move the tick, so a quote token's scale can't be assumed",
    priceToTick(1, 18, 6) !== priceToTick(1, 18, 18),
    `${priceToTick(1, 18, 6)} ${priceToTick(1, 18, 18)}`,
  );
  check(
    "parity is tick zero when both sides share decimals",
    priceToTick(1, 18, 18) === 0 && tickToPrice(0, 18, 18) === 1,
  );
  check(
    "a nonsense price doesn't produce a nonsense tick",
    priceToTick(0, 18, 18) === 0 && priceToTick(-1, 18, 18) === 0,
  );
  check(
    "and an unreachable one is clamped rather than passed to a uint",
    priceToTick(1e300, 18, 18) === MAX_TICK &&
      priceToTick(1e-300, 18, 18) === MIN_TICK,
    `${priceToTick(1e300, 18, 18)} ${priceToTick(1e-300, 18, 18)}`,
  );
}

/*
 * The clamp a drained pool stops at.
 *
 * Not hypothetical, and not a mainnet-scale event either: a KLD/USDC 0.30% pool
 * on Robinhood Chain Testnet held 0.019 KLD and 117 USDC at tick 887271, its
 * sqrtPriceX96 one below MAX_SQRT_RATIO. A ~117 USDC buy took every KLD in it and
 * the swap clamped rather than reverted. `tickToPrice` answered 3.4e50 for that
 * tick, which is 2^128 scaled by the decimal gap and entirely correct as
 * arithmetic; the /pool table printed it, the unpriced-leg derivation valued KLD
 * at it, and the headline read $6.47e48. What is pinned below is therefore the
 * line where a tick stops being a price.
 */
console.log("\n— a pinned tick is refused, and a real one is not —");
{
  check(
    "the measured pool: tick 887271 at the 0.30% tier",
    isTickPinned(887271, 3000),
  );
  check("and the same clamp on the floor", isTickPinned(-887271, 3000));
  check(
    "the ticks either side of it too, since nothing can sit out there",
    isTickPinned(MAX_TICK, 3000) &&
      isTickPinned(MIN_TICK, 3000) &&
      isTickPinned(887220, 3000),
    "887220 is the widest tick the 0.30% tier can mint at, so it is the clamp",
  );
  /* Two measured ticks that ARE markets, both KLD/USDC at 0.30% and both far from
     parity — which is the case worth pinning, since a guard reaching for "this
     number looks too big" would blank them. 303397 is Sepolia's live pool, where
     USDC sorts first, so its price is 14.99 KLD per USDC; -311349 is the same pair
     where KLD sorts first, at $0.0301. The same market, read from either side,
     lands six figures of ticks from zero without being pinned at either end. */
  check("a live pool's tick is not pinned", !isTickPinned(303397, 3000));
  check(
    "nor is the same market read the other way",
    !isTickPinned(-311349, 3000),
  );
  check("nor is parity itself", !isTickPinned(0, 3000));

  /* Derived from the tier rather than from a plausibility threshold, which is the
     whole point: `fullRangeTicks` is the widest range a mint accepts, so a tick
     outside it is a price no position can be opened at, at any spacing. */
  for (const [feeKey, spacing] of Object.entries(TICK_SPACINGS)) {
    const fee = Number(feeKey);
    const { tickUpper } = fullRangeTicks(spacing);
    check(
      `fee ${fee}: the outermost mintable tick is pinned, one spacing in is not`,
      isTickPinned(tickUpper, fee) &&
        isTickPinned(-tickUpper, fee) &&
        !isTickPinned(tickUpper - spacing, fee) &&
        !isTickPinned(-(tickUpper - spacing), fee),
      `tickUpper ${tickUpper} spacing ${spacing}`,
    );
  }

  /* An unknown fee has no spacing to look up and a NaN tick has no magnitude to
     compare, so both fail closed. A missing price is recoverable copy; a printed
     3.4e50 is not. */
  check(
    "an unknown fee tier still bounds the tick",
    isTickPinned(887271, 1234),
  );
  check(
    "and stays honest about a real one",
    !isTickPinned(303397, 1234),
    "MAX_TICK - 1 is the fallback, so only the true extremes are pinned",
  );
  check(
    "a tick that is not a number is pinned, not passed through",
    isTickPinned(NaN, 3000) &&
      isTickPinned(Infinity, 3000) &&
      isTickPinned(-Infinity, 3000),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
