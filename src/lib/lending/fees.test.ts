/**
 * Tests for the lending fee arithmetic.
 *
 * These four functions are the only place the app derives a number from
 * `getBPS()` / `getLiquidityBPS()`, and every one of them is a claim about what
 * ProtocolFacet does — so each case below is checked against the facet's own
 * integer arithmetic rather than against a remembered rate.
 *
 * The stakes are why this file exists. `netLenderRateBps` is printed beside a
 * lender's own offer as what they will earn; `penaltySplitBps` is printed to a
 * borrower as what being liquidated costs. Both are wrong-quietly failures — a
 * mistake renders as a plausible percentage, not as an error — and neither is
 * reachable from `tsc`.
 *
 * Run: npx tsx src/lib/lending/fees.test.ts
 */

import {
  BPS_DENOMINATOR,
  bpsToPercent,
  formatBps,
  lenderInterestShareBps,
  LIQUIDATOR_PENALTY_SHARE_PCT,
  netLenderRateBps,
  penaltySplitBps,
} from "./fees.ts";

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

/* The values every deployed diamond holds, measured on all five chains
   2026-08-24. Hardcoding the live pair is deliberate: a regression that changed
   the maths would still pass against whatever the maths itself produced. */
const LIVE_INTEREST_FEE = 1000;
const LIVE_PENALTY = 640;

console.log("— bpsToPercent —");
check("640 is 6.4", bpsToPercent(640) === 6.4);
check("1000 is 10", bpsToPercent(1000) === 10);
check("the denominator is 100%", bpsToPercent(BPS_DENOMINATOR) === 100);
check("1 bp is a hundredth of a percent", bpsToPercent(1) === 0.01);

console.log("— netLenderRateBps —");
/*
 * The facet's model, restated: repayLoan credits the lender `payment - fee`,
 * where `_repaymentFee` is ONE_PERCENT_BPS of the interest portion of that
 * payment (ProtocolFacet.sol:2576) and `Utils.calculateFeesPercentage` is
 * `(amount * bps) / 10000`. On a full repayment the interest portion is the whole
 * interest accrued, so the lender receives principal plus
 * `interest * (1 - feeBps/10000)` — which is the gross rate scaled by exactly
 * that factor, independent of principal and term.
 */
check(
  "a 1200 bps offer at the live fee nets 1080",
  netLenderRateBps(1200, LIVE_INTEREST_FEE) === 1080,
);
check(
  "the book's 8.5% offer nets 7.65%",
  netLenderRateBps(850, LIVE_INTEREST_FEE) === 765,
);
check(
  "derived from the facet, not the constant",
  // 900 bps gross, 1000 bps fee: (900 * (10000 - 1000)) / 10000 = 810
  netLenderRateBps(900, LIVE_INTEREST_FEE) === (900 * (10_000 - 1000)) / 10_000,
);
check("a zero fee is a pass-through", netLenderRateBps(1200, 0) === 1200);
check(
  "a 100% fee leaves the lender nothing",
  netLenderRateBps(1200, BPS_DENOMINATOR) === 0,
);
check("a zero rate stays zero", netLenderRateBps(0, LIVE_INTEREST_FEE) === 0);
/* The one case that must not produce a number. An unread fee rendered as 0 would
   claim the lender keeps everything — the opposite of what the chain means by a
   zero, since setBPS rejects it and repayLoan reverts on it. */
check(
  "an unknown fee yields null, not the gross rate",
  netLenderRateBps(1200, null) === null,
);
check(
  "null is not coerced at zero gross either",
  netLenderRateBps(0, null) === null,
);
check(
  "the net rate is never above the gross",
  [100, 480, 610, 850, 1120, 5000].every((g) => {
    const net = netLenderRateBps(g, LIVE_INTEREST_FEE);
    return net !== null && net < g;
  }),
);

console.log("— lenderInterestShareBps —");
check(
  "the live fee leaves the lender 90% of interest",
  lenderInterestShareBps(LIVE_INTEREST_FEE) === 9000,
);
check(
  "a zero fee leaves all of it",
  lenderInterestShareBps(0) === BPS_DENOMINATOR,
);
check(
  "share and fee sum to the denominator",
  [1, 250, 1000, 3333, 9999].every(
    (f) => lenderInterestShareBps(f) + f === BPS_DENOMINATOR,
  ),
);
check(
  "the share scales the gross rate the same way netLenderRateBps does",
  (1200 * lenderInterestShareBps(LIVE_INTEREST_FEE)) / BPS_DENOMINATOR ===
    netLenderRateBps(1200, LIVE_INTEREST_FEE),
);

console.log("— penaltySplitBps —");
/* `liquidatorUsd = (penaltyUsd * 75) / 100; protocolUsd = penaltyUsd - liquidatorUsd`
   — ProtocolFacet.sol:1707-1708. The 75 is hardcoded in the facet, not stored, so
   LIQUIDATOR_PENALTY_SHARE_PCT mirrors it and this pins the mirror. */
check("the mirrored share is 75", LIQUIDATOR_PENALTY_SHARE_PCT === 75);
const live = penaltySplitBps(LIVE_PENALTY);
check("640 bps splits 480 to the liquidator", live.liquidator === 480);
check("640 bps splits 160 to the protocol", live.protocol === 160);
check(
  "the two legs sum to exactly the penalty",
  [1, 7, 100, 333, 640, 1000, 9999].every((p) => {
    const { liquidator, protocol } = penaltySplitBps(p);
    return liquidator + protocol === p;
  }),
  "the facet takes the protocol's leg as the remainder precisely so this holds",
);
check(
  "the liquidator always takes the larger share",
  [100, 640, 1000, 5000].every((p) => {
    const { liquidator, protocol } = penaltySplitBps(p);
    return liquidator > protocol;
  }),
);
const zero = penaltySplitBps(0);
check(
  "a zero penalty splits into nothing",
  zero.liquidator === 0 && zero.protocol === 0,
);
/*
 * Where this module and the facet legitimately diverge.
 *
 * The facet truncates: at a 333 bps penalty it would hand the liquidator
 * `(333 * 75) / 100 = 249` and the protocol 84. This is floating point, so it
 * splits 249.75 / 83.25. The difference is a quarter of a basis point and these
 * figures are only ever formatted to two decimal places, so nothing visible
 * moves — but the two are not bit-identical and no caller should treat a value
 * from here as a settlement amount. Pinned so the divergence stays deliberate.
 */
const odd = penaltySplitBps(333);
check(
  "an indivisible penalty splits in real arithmetic, not the facet's integers",
  odd.liquidator === 249.75 && odd.protocol === 83.25,
);
check(
  "and the two roundings agree at two decimal places anyway",
  formatBps(odd.liquidator) === "2.5%" && formatBps(249) === "2.49%",
  "2.4975 vs 2.49 — displayed to the borrower as 2.5% either way",
);

console.log("— formatBps —");
check("the live fee reads 10%", formatBps(LIVE_INTEREST_FEE) === "10%");
check("the live penalty reads 6.4%", formatBps(LIVE_PENALTY) === "6.4%");
check("the liquidator's leg reads 4.8%", formatBps(480) === "4.8%");
check("a whole percent drops its zeros", formatBps(100) === "1%");
check("a fractional rate keeps two places", formatBps(765) === "7.65%");
check(
  "a third decimal place rounds up",
  // 766.7 bps is 7.667%, which must not present as 7.66%
  formatBps(766.7) === "7.67%",
);
check(
  "a sub-hundredth rate does not read as zero-ish nonsense",
  formatBps(1) === "0.01%",
);
/* The whole reason the type is `number | null`: an em dash, never "0%". A screen
   that printed 0% would be asserting a waiver the contract does not grant. */
check("null renders as an em dash", formatBps(null) === "—");
check("null is not 0%", formatBps(null) !== "0%");
check("a real zero still reads as 0%", formatBps(0) === "0%");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
