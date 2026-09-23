/**
 * Swap-volume milestone tiers: the highest-tier-only payout and the per-tier UI
 * state. Pure arithmetic — the DB reader (walletSwapVolumeUsd) is thin glue over
 * Supabase, exercised by the waitlist route, not here.
 *
 * Run with `npx tsx src/lib/waitlist/swapVolume.test.ts`.
 */
import {
  SWAP_VOLUME_TIERS,
  swapVolumePoints,
  highestSwapTier,
  swapVolumeStanding,
} from "./swapVolume.ts";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, got?: string) {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${got}`}`);
  }
}

console.log("\n— the tier ladder —");
check(
  "three tiers: $10→500, $50→700, $100→1000",
  JSON.stringify(SWAP_VOLUME_TIERS.map((t) => [t.threshold, t.points])) ===
    JSON.stringify([
      [10, 500],
      [50, 700],
      [100, 1000],
    ]),
  JSON.stringify(SWAP_VOLUME_TIERS),
);
check(
  "tiers are sorted ascending by threshold",
  SWAP_VOLUME_TIERS.every(
    (t, i) => i === 0 || t.threshold > SWAP_VOLUME_TIERS[i - 1].threshold,
  ),
);

console.log("\n— highest-tier-only payout —");
check("below the smallest tier earns nothing", swapVolumePoints(9.99) === 0, String(swapVolumePoints(9.99)));
check("exactly $10 earns 500", swapVolumePoints(10) === 500, String(swapVolumePoints(10)));
check("$49.99 still only the $10 tier (500)", swapVolumePoints(49.99) === 500, String(swapVolumePoints(49.99)));
check("exactly $50 earns 700", swapVolumePoints(50) === 700, String(swapVolumePoints(50)));
check("$99.99 still only the $50 tier (700)", swapVolumePoints(99.99) === 700, String(swapVolumePoints(99.99)));
check("exactly $100 earns 1000", swapVolumePoints(100) === 1000, String(swapVolumePoints(100)));
check("well past the top tier stays 1000 (no stacking)", swapVolumePoints(100000) === 1000, String(swapVolumePoints(100000)));
check("zero volume earns nothing", swapVolumePoints(0) === 0, String(swapVolumePoints(0)));

console.log("\n— highestSwapTier —");
check("no tier reached is null", highestSwapTier(5) === null);
check("$75 → the $50 tier", highestSwapTier(75)?.threshold === 50, JSON.stringify(highestSwapTier(75)));
check("$100 → the $100 tier", highestSwapTier(100)?.threshold === 100, JSON.stringify(highestSwapTier(100)));

console.log("\n— swapVolumeStanding: per-tier UI state —");
{
  // $60: $10 + $50 met (highest = $50), $100 not met.
  const s = swapVolumeStanding(60);
  check("credited points = highest reached (700)", s.points === 700, String(s.points));
  const byKey = Object.fromEntries(s.tiers.map((t) => [t.key, t]));
  check("$10 tier is done", byKey.vol10.done === true);
  check("$10 tier is superseded (higher tier met)", byKey.vol10.superseded === true);
  check("$50 tier is done and NOT superseded (it is the top)", byKey.vol50.done && !byKey.vol50.superseded);
  check("$100 tier is not done", byKey.vol100.done === false);
  check("$100 tier is not superseded", byKey.vol100.superseded === false);
  // The shown-points invariant: the only non-superseded, done tier carries the
  // whole credited total, so what the UI shows sums to what is credited.
  const shown = s.tiers
    .filter((t) => t.done && !t.superseded)
    .reduce((sum, t) => sum + t.points, 0);
  check("shown (done, non-superseded) points equal credited", shown === s.points, `${shown} vs ${s.points}`);
}
{
  // $100+: all three met, only the $100 tier pays.
  const s = swapVolumeStanding(250);
  check("all three tiers done at $250", s.tiers.every((t) => t.done));
  check("only the $100 tier is non-superseded", s.tiers.filter((t) => !t.superseded).length === 1);
  check("credited is 1000 at $250", s.points === 1000, String(s.points));
}
{
  // Below everything: nothing done, nothing credited.
  const s = swapVolumeStanding(3);
  check("nothing done below $10", s.tiers.every((t) => !t.done));
  check("nothing superseded below $10", s.tiers.every((t) => !t.superseded));
  check("credited is 0 below $10", s.points === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
