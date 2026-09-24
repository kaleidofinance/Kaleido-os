// Task points + the Season 1 sync. Run: npx tsx src/lib/waitlist/sync.test.ts
//
// Pins the property the leaderboard/rewards mismatch broke: the ledger top-up
// is decided by the SAME calculation the /rewards card shows, for every wallet,
// without that wallet having to open the card.
import {
  PER_REFERRAL,
  X_HOLD_MS,
  countedXPoints,
  eligibleTaskPoints,
  topUpOwed,
  topUpRow,
} from "./eligible.ts";
import { planTopUps } from "./sync.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got = "") => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${got}`); }
};

const NOW = Date.parse("2026-09-24T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

console.log("\n— X tasks count only after their hold —");
{
  const row = {
    x_linked_at: ago(X_HOLD_MS + 1),     // cleared → 100
    x_commented_at: ago(X_HOLD_MS + 1),  // cleared → 50
    x_followed_at: ago(60_000),          // still held → 0
  };
  check("cleared tasks count, held ones don't", countedXPoints(row, NOW) === 150, String(countedXPoints(row, NOW)));
}

console.log("\n— the task total —");
{
  const row = {
    welcome_points: 100,
    x_linked_at: ago(X_HOLD_MS + 1),
    bridge_tx_at: ago(1000),
  };
  const got = eligibleTaskPoints({ row, referrals: 3, swapVolumeUsd: 60, now: NOW });
  // 100 welcome + 3×50 + 100 linked + 500 bridge + 700 ($50 tier)
  check("welcome + referrals + X + transaction + volume tier", got === 100 + 3 * PER_REFERRAL + 100 + 500 + 700, String(got));
  check("negative referrals never subtract", eligibleTaskPoints({ row: { welcome_points: 100 }, referrals: -5, swapVolumeUsd: 0, now: NOW }) === 100);
}

console.log("\n— the top-up rule —");
{
  check("owed the difference", topUpOwed({ eligible: 900, credited: 700, activated: true }) === 200);
  check("forward-only: a shrunk total owes nothing", topUpOwed({ eligible: 600, credited: 700, activated: true }) === 0);
  check("never activated + never credited → stays pending", topUpOwed({ eligible: 900, credited: 0, activated: false }) === 0);
  check("bulk-credited before the activated flag → still topped up", topUpOwed({ eligible: 900, credited: 400, activated: false }) === 500);
  const row = topUpRow("0xabc", 900, 200, "2026-09-24T12:00:00.000Z");
  check(
    "top-up row: waitlist source, Season 1, Arc, stable idempotency key",
    row.source_slug === "waitlist" && row.season === 1 && row.chain_id === 5042 &&
      row.tx_hash === "waitlist:reconcile:0xabc:900" && row.points === 200,
    JSON.stringify(row),
  );
}

console.log("\n— the bulk plan (what the job writes) —");
{
  const rows = [
    // Earned 2 referrals after activation → the leaderboard was behind by 100.
    { wallet: "0xAAA", welcome_points: 100, activated_at: ago(1e7) },
    // Level already.
    { wallet: "0xbbb", welcome_points: 100, activated_at: ago(1e7) },
    // Never activated, never credited → nothing (points stay pending).
    { wallet: "0xccc", welcome_points: 100, activated_at: null },
    // Crossed the $100 volume tier → owed the tier.
    { wallet: "0xddd", welcome_points: 100, activated_at: ago(1e7) },
  ];
  const plan = planTopUps({
    rows,
    referrals: new Map([["0xaaa", 2]]),
    credited: new Map([["0xaaa", 100], ["0xbbb", 100], ["0xddd", 100]]),
    swapVolumeUsd: new Map([["0xddd", 120]]),
    now: NOW,
  });
  const by = new Map(plan.map((p) => [p.wallet, p]));
  check("referrals earned after activation are topped up (wallet lowercased)", by.get("0xaaa")?.delta === 100, JSON.stringify(by.get("0xaaa")));
  check("a level wallet gets nothing", !by.has("0xbbb"));
  check("an unactivated, uncredited wallet gets nothing", !by.has("0xccc"));
  check("a new volume tier is topped up", by.get("0xddd")?.delta === 1000, JSON.stringify(by.get("0xddd")));
  check("only owed wallets are planned", plan.length === 2, String(plan.length));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
