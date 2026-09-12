/**
 * Tests for the cross-chain borrow-position arithmetic.
 *
 * This is the scaling the portfolio's Borrowing figures depend on once it reads
 * every chain: `getHealthFactor` is a 1e18-scaled ratio with 2^256-1 as its "no
 * debt" sentinel, and `getUsdValue(token, 1, 0)` is a unit price at 1e18. A slip
 * in either renders as a plausible dollar figure or health factor, not as an
 * error, and none of it is reachable from `tsc` — so each case here pins the math
 * to a known input rather than to a remembered result.
 *
 * Run: npx tsx src/lib/lending/positions.test.ts
 */

import {
  NO_DEBT_SENTINEL,
  scaleHealth,
  spotFromUsdValue,
  aggregateBorrow,
  type RawCollateral,
  type RawDebt,
} from "./positions.ts";

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

const e = (n: number, d: number): bigint => BigInt(n) * 10n ** BigInt(d);

// ---- scaleHealth --------------------------------------------------------
check("health 1.5e18 → 1.5", scaleHealth((15n * 10n ** 18n) / 10n) === 1.5);
check("health 1e18 → 1.0", scaleHealth(10n ** 18n) === 1);
check("no-debt sentinel → Infinity", scaleHealth(NO_DEBT_SENTINEL) === Infinity);
check(
  "a near-1 ratio survives the scale",
  Math.abs(scaleHealth(1_050_000_000_000_000_000n) - 1.05) < 1e-9,
);

// ---- spotFromUsdValue ---------------------------------------------------
check("spot 3000e18 → 3000", spotFromUsdValue(e(3000, 18)) === 3000);
check("spot 1e18 → 1 (a dollar-pegged token)", spotFromUsdValue(e(1, 18)) === 1);
check("spot 5e17 → 0.5", spotFromUsdValue(5n * 10n ** 17n) === 0.5);

// ---- aggregateBorrow: collateral ---------------------------------------
const coll: RawCollateral[] = [
  // 2 WETH @ $3000 = $6000
  { address: "0xeth", symbol: "WETH", decimals: 18, rawAmount: e(2, 18), rawSpot: e(3000, 18) },
  // 100 USDC (6dp) @ $1 = $100
  { address: "0xusdc", symbol: "USDC", decimals: 6, rawAmount: e(100, 6), rawSpot: e(1, 18) },
  // zero balance — dropped
  { address: "0xzero", symbol: "ZERO", decimals: 18, rawAmount: 0n, rawSpot: e(1, 18) },
];
const a1 = aggregateBorrow(97, coll, [], NO_DEBT_SENTINEL);
check("collateral sums across mixed decimals", a1.collateralUsd === 6100);
check("zero-amount collateral is dropped", a1.collateral.length === 2);
check("per-token usd is priced (WETH row = 6000)",
  a1.collateral.find((c) => c.symbol === "WETH")?.usd === 6000);
check("no-debt health passes through as Infinity", a1.health === Infinity);
check("empty debt side sums to 0, not null", a1.debtUsd === 0);

// ---- aggregateBorrow: an unpriced holding makes the total null ----------
const collUnpriced: RawCollateral[] = [
  { address: "0xeth", symbol: "WETH", decimals: 18, rawAmount: e(1, 18), rawSpot: e(3000, 18) },
  { address: "0xnofeed", symbol: "XYZ", decimals: 18, rawAmount: e(5, 18), rawSpot: null },
];
const a2 = aggregateBorrow(97, collUnpriced, [], null);
check("a present-but-unpriced holding makes the total null (not short)",
  a2.collateralUsd === null);
check("the unpriced row still renders with usd null",
  a2.collateral.find((c) => c.symbol === "XYZ")?.usd === null);
check("unread health is null, not 0", a2.health === null);

// ---- aggregateBorrow: debt ---------------------------------------------
const debts: RawDebt[] = [
  // 500 USDC owed @ $1 = $500
  { requestId: 7, address: "0xusdc", symbol: "USDC", decimals: 6, rawOutstanding: e(500, 6), interestBps: 850, returnDate: 0, rawSpot: e(1, 18) },
  // fully repaid — dropped
  { requestId: 8, address: "0xusdc", symbol: "USDC", decimals: 6, rawOutstanding: 0n, interestBps: 850, returnDate: 0, rawSpot: e(1, 18) },
];
const a3 = aggregateBorrow(97, [], debts, e(2, 18));
check("debt sums to 500", a3.debtUsd === 500);
check("a repaid (zero) debt is dropped", a3.debts.length === 1);
check("health 2e18 → 2.0", a3.health === 2);
check("empty collateral side sums to 0", a3.collateralUsd === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
