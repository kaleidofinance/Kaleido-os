/**
 * The action-credit arithmetic — the numbers a mistake would leak tokens through.
 *
 * Run with `npx tsx src/lib/points/credit.test.ts`.
 *
 * Only `computeActionCredit` is exercised: it is the pure composition of the
 * `minUsd` floor, the multiplier decay, and the daily cap. The DB wrapper
 * (`creditAction`) is thin glue over Supabase and idempotency, tested by the
 * indexer that drives it, not here.
 */
import { computeActionCredit } from "./credit.ts";
import type { SourceRate } from "./accrual.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${got}`}`); }
};

const rate: SourceRate = {
  rate: 10,
  multiplier: 1.2,
  minUsd: 5,
  dailyCapPts: 1000,
  multiplierActionLimit: 3,
};

console.log("\n— the minUsd floor —");
{
  const r = computeActionCredit(3, rate, 0, 0);
  check("a swap below minUsd earns nothing", r.points === 0, String(r.points));
  const ok = computeActionCredit(5, rate, 0, 0);
  check("exactly minUsd earns", ok.points > 0, String(ok.points));
}

console.log("\n— the bonus multiplier and its decay —");
{
  const boosted = computeActionCredit(50, rate, 0, 0); // 50*10*1.2 = 600
  check("under the action limit, the 1.2× applies", boosted.points === 600 && boosted.multiplierApplied === 1.2, JSON.stringify(boosted));
  const decayed = computeActionCredit(50, rate, 3, 0); // at/over limit → 1× → 500
  check("at the daily action limit, the bonus decays to 1×", decayed.points === 500 && decayed.multiplierApplied === 1, JSON.stringify(decayed));
}

console.log("\n— the daily points cap —");
{
  // 100*10*1.2 = 1200, but the cap is 1000 and nothing spent yet
  const capped = computeActionCredit(100, rate, 0, 0);
  check("a big swap is clamped to the daily cap", capped.points === 1000, String(capped.points));
  // 10*10*1.2 = 120, but only 50 of the day's cap is left
  const nearFull = computeActionCredit(10, rate, 0, 950);
  check("near the cap, only the remaining room is credited", nearFull.points === 50, String(nearFull.points));
  // cap already spent
  const full = computeActionCredit(10, rate, 0, 1000);
  check("once the cap is spent, nothing more credits", full.points === 0, String(full.points));
}

console.log("\n— an uncapped source —");
{
  const uncapped: SourceRate = { ...rate, dailyCapPts: null };
  const r = computeActionCredit(100, uncapped, 0, 99999);
  check("with no cap, the full amount credits regardless of the day", r.points === 1200, String(r.points));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
