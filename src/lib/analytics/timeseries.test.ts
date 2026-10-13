/**
 * Daily bucketing for the /analytics charts, offline.
 * Run: `npx tsx src/lib/analytics/timeseries.test.ts`.
 *
 * bucketDaily is pure — the reader that feeds it the ledger rows is integration
 * only — so this pins the day math, the first-seen-wallet rule, the window
 * boundary and the fee derivation with a fixed `now`.
 */

import { bucketDaily } from "@/lib/analytics/timeseries";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL: ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`);
  }
}
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const NOW = Date.parse("2026-09-22T12:00:00Z"); // window (days=3) → 09-20, 09-21, 09-22

const out = bucketDaily({
  actions: [
    { wallet: "0xA", source_slug: "swap", usd_value: 100, occurred_at: "2026-09-22T01:00:00Z" },
    { wallet: "0xA", source_slug: "swap", usd_value: 50, occurred_at: "2026-09-21T10:00:00Z" }, // 0xA first-seen 09-21
    { wallet: "0xB", source_slug: "swap", usd_value: 30, occurred_at: "2026-09-22T09:00:00Z" }, // 0xB first-seen 09-22
    { wallet: "0xC", source_slug: "swap", usd_value: 999, occurred_at: "2026-08-01T00:00:00Z" }, // outside window
    { wallet: "0xB", source_slug: "lend", usd_value: 5, occurred_at: "2026-09-22T09:00:00Z" }, // not a swap
  ],
  cctp: [{ created_at: "2026-09-22T00:00:00Z", amount: "10" }],
  route: [{ created_at: "2026-09-21T00:00:00Z", usd_value: 200 }],
  days: 3,
  swapFeeRate: 0.002,
  lifiFeeRate: 0.001,
  now: NOW,
});

console.log("— window shape —");
check("three days, oldest → newest", out.length === 3 && out[0].date === "2026-09-20" && out[2].date === "2026-09-22", out.map((d) => d.date));
check("the empty day is all zeros", out[0].volumeUsd === 0 && out[0].swaps === 0 && out[0].newWallets === 0);

console.log("\n— 09-21 —");
const d21 = out[1];
check("swap volume + route bridge", approx(d21.volumeUsd, 250), d21.volumeUsd); // 50 swap + 200 route
check("one swap", d21.swaps === 1);
check("0xA counts new on its first-seen day", d21.newWallets === 1, d21.newWallets);
check("fees = swapVol*rate + routeVol*rate", approx(d21.feesUsd, 50 * 0.002 + 200 * 0.001), d21.feesUsd);

console.log("\n— 09-22 —");
const d22 = out[2];
check("two swaps' volume + cctp", approx(d22.volumeUsd, 140), d22.volumeUsd); // (100+30) swap + 10 cctp
check("two swaps (the lend is excluded)", d22.swaps === 2, d22.swaps);
check("0xB new; 0xA already seen 09-21 so not new again", d22.newWallets === 1, d22.newWallets);
check("cctp adds volume but no fee", approx(d22.feesUsd, 130 * 0.002), d22.feesUsd);

console.log("\n— out-of-window wallet is neither new nor counted —");
check("0xC's old $999 never enters any bucket", out.every((d) => d.volumeUsd < 999));

console.log("\n— empty input → zero-filled window —");
{
  const e = bucketDaily({ actions: [], cctp: [], route: [], days: 5, swapFeeRate: 0.002, lifiFeeRate: 0.001, now: NOW });
  check("five zero days", e.length === 5 && e.every((d) => d.volumeUsd === 0 && d.newWallets === 0));
}

console.log("\n— the swap_volume ledger drives swap volume/count/fees —");
{
  const led = bucketDaily({
    // point_actions still decide new wallets; the only credited swap is $100.
    actions: [{ wallet: "0xA", source_slug: "swap", usd_value: 100, occurred_at: "2026-09-22T01:00:00Z" }],
    swaps: [
      { usd_value: 100, fee_paid: true, occurred_at: "2026-09-22T01:00:00Z" }, // the credited one
      { usd_value: 4, fee_paid: true, occurred_at: "2026-09-22T02:00:00Z" }, // under the $10 floor — no credit
      { usd_value: 20, fee_paid: false, occurred_at: "2026-09-22T03:00:00Z" }, // a direct pool trade — no fee
    ],
    cctp: [],
    route: [],
    days: 3,
    swapFeeRate: 0.002,
    lifiFeeRate: 0.001,
    now: NOW,
  });
  const d = led[2];
  check("volume counts every swap, sub-$10 included", approx(d.volumeUsd, 124), d.volumeUsd);
  check("swap count is the ledger's, not the credits'", d.swaps === 3, d.swaps);
  check("fees only on fee-paying volume (the pool trade pays none)", approx(d.feesUsd, 104 * 0.002), d.feesUsd);
  check("new wallets still come from point_actions", d.newWallets === 1, d.newWallets);

  const fallback = bucketDaily({
    actions: [{ wallet: "0xA", source_slug: "swap", usd_value: 100, occurred_at: "2026-09-22T01:00:00Z" }],
    cctp: [], route: [], days: 3, swapFeeRate: 0.002, lifiFeeRate: 0.001, now: NOW,
  });
  check("no ledger → falls back to credited swaps (unchanged behaviour)", approx(fallback[2].volumeUsd, 100) && fallback[2].swaps === 1, fallback[2]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
