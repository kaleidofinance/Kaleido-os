// Lending positions → USD per wallet. What these protect: each loan pays its
// lender `lend` and its borrower `borrow` on min(principal, still owed) — never on
// interest, and less after a partial repayment; idle collateral is priced at its
// own decimals; our own wallets earn nothing; and an unpriced token is REPORTED,
// never silently valued at zero (a false zero would erase an interval for good).
//
//   npm run test:lendingsnapshot

import { lendingUsd, type ServicedLoan, type TokenInfo } from "./lendingSnapshot.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got ? " " + got : ""}`);
  }
};
const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-6;

const NATIVE = "0x0000000000000000000000000000000000000001";
const EURC = "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1";
const CIRBTC = "0x171a4217b86a807a64eb94757db6849fb4bdbaa0";
const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const VAULT = "0x0ce7f8aeaad60b9e19acbe9803518182adc351bc";
const U = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n; // native USDC, 18dp

const tokens = new Map<string, TokenInfo>([
  [NATIVE, { decimals: 18, usd: 1 }],
  [EURC, { decimals: 6, usd: 1.14 }],
  [CIRBTC, { decimals: 8, usd: 80_000 }],
]);
const loan = (author: string, lender: string, amount: bigint, owed: bigint): ServicedLoan => ({
  author,
  lender,
  token: NATIVE,
  amount,
  totalRepayment: owed,
});

{
  const v = lendingUsd({
    loans: [loan(ALICE, BOB, U(100), U(101.5))],
    free: [],
    tokens,
    exclude: new Set(),
  });
  check("the lender earns lend on the principal, not the interest", near(v.bySource.lend.get(BOB), 100), String(v.bySource.lend.get(BOB)));
  check("the borrower earns borrow on the same principal", near(v.bySource.borrow.get(ALICE), 100));
  check("neither side earns the other's source", !v.bySource.lend.has(ALICE) && !v.bySource.borrow.has(BOB));
}
{
  const v = lendingUsd({ loans: [loan(ALICE, BOB, U(100), U(40))], free: [], tokens, exclude: new Set() });
  check("after a partial repayment only what is still owed counts", near(v.bySource.lend.get(BOB), 40) && near(v.bySource.borrow.get(ALICE), 40));
}
{
  const v = lendingUsd({ loans: [loan(ALICE, BOB, U(100), 0n)], free: [], tokens, exclude: new Set() });
  check("a fully repaid loan earns nothing", v.bySource.lend.size === 0 && v.bySource.borrow.size === 0);
}
{
  const v = lendingUsd({
    loans: [loan(ALICE, BOB, U(10), U(10)), loan(BOB, ALICE, U(5), U(5)), loan(ALICE, BOB, U(20), U(20))],
    free: [],
    tokens,
    exclude: new Set(),
  });
  check("positions sum per wallet, and one wallet can be lender AND borrower",
    near(v.bySource.lend.get(BOB), 30) && near(v.bySource.borrow.get(ALICE), 30) &&
      near(v.bySource.lend.get(ALICE), 5) && near(v.bySource.borrow.get(BOB), 5));
}
{
  const v = lendingUsd({
    loans: [],
    free: [
      { wallet: ALICE, token: EURC, amount: 15_000_000n }, // 15 EURC
      { wallet: ALICE, token: CIRBTC, amount: 10_000n }, // 0.0001 cirBTC
      { wallet: BOB, token: EURC, amount: 0n },
    ],
    tokens,
    exclude: new Set(),
  });
  check("idle collateral is priced at each token's own decimals (6-dec EURC + 8-dec cirBTC)",
    near(v.bySource.collateral_idle.get(ALICE), 15 * 1.14 + 8), String(v.bySource.collateral_idle.get(ALICE)));
  check("a zero free balance earns nothing (no zero rows)", !v.bySource.collateral_idle.has(BOB));
}
{
  const v = lendingUsd({
    loans: [loan(ALICE, VAULT, U(50), U(50))],
    free: [{ wallet: VAULT, token: EURC, amount: 1_000_000n }],
    tokens,
    exclude: new Set([VAULT]),
  });
  check("an excluded (operator) wallet earns nothing on any source",
    !v.bySource.lend.has(VAULT) && !v.bySource.collateral_idle.has(VAULT));
  check("but its counterparty still earns", near(v.bySource.borrow.get(ALICE), 50));
}
{
  const UNKNOWN = "0x4444444444444444444444444444444444444444";
  const v = lendingUsd({
    loans: [],
    free: [{ wallet: ALICE, token: UNKNOWN, amount: 1n }, { wallet: BOB, token: EURC, amount: 1_000_000n }],
    tokens,
    exclude: new Set(),
  });
  check("an unpriced token is reported, not valued at zero", v.unpriced.join() === UNKNOWN && !v.bySource.collateral_idle.has(ALICE));
  check("and priced positions alongside it are still valued", near(v.bySource.collateral_idle.get(BOB), 1.14));
}
{
  const v = lendingUsd({
    loans: [loan(ALICE.toUpperCase().replace("0X", "0x"), BOB, U(1), U(1))],
    free: [],
    tokens,
    exclude: new Set(),
  });
  check("wallets are keyed lowercase", v.bySource.borrow.has(ALICE));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
