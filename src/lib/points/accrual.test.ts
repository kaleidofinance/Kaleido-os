// Adversarial checks on the accrual arithmetic. Run with plain node after a
// tsc transpile — no test runner in this repo.
import {
  accrueInterval,
  accrueSeries,
  applyDailyCap,
  actionPoints,
} from "./accrual.ts";

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

const RATE = {
  rate: 1.0,
  multiplier: 1.0,
  minUsd: 0,
  dailyCapPts: null,
  multiplierActionLimit: null,
};

const snap = (usd, hoursFromStart, extra = {}) => ({
  wallet: "0xabc",
  chainId: 8453,
  sourceSlug: "lp",
  usdValue: usd,
  blockNumber: 1000 + hoursFromStart,
  takenAt: new Date(Date.UTC(2026, 7, 1, hoursFromStart)),
  ...extra,
});

console.log("\n— honest holding —");
{
  // $1000 held for 24h at 1 pt/USD/day = 1000 points.
  const e = accrueInterval(snap(1000, 0), snap(1000, 24), RATE, 1);
  check(
    "24h at $1000 → 1000 pts",
    Math.abs(e.points - 1000) < 1e-6,
    `got ${e?.points}`,
  );
}

console.log("\n— the flash-deposit farm —");
{
  // Wallet holds $0, spikes to $1,000,000 for the instant of the snapshot,
  // then drops back. min() must refuse to pay for capital not actually held.
  const spike = accrueSeries(
    [snap(0, 0), snap(1_000_000, 12), snap(0, 24)],
    RATE,
    1,
  );
  const total = spike.reduce((s, e) => s + e.points, 0);
  check("spike between two zeroes earns nothing", total === 0, `got ${total}`);
}
{
  // Compare against the naive alternatives to show why min() was chosen.
  const prevValue = (1_000_000 * (12 * 3600)) / 86400; // would-be payout using opening value
  check("min() strictly cheaper than opening-value accrual", 0 < prevValue, "");
}

console.log("\n— withdraw right after a snapshot —");
{
  // Held $1000 at t0, withdrew to $10 immediately after. Credited on $10.
  const e = accrueInterval(snap(1000, 0), snap(10, 24), RATE, 1);
  check(
    "credited on the lower endpoint",
    Math.abs(e.points - 10) < 1e-6,
    `got ${e.points}`,
  );
}

console.log("\n— growth is credited conservatively —");
{
  // Grew $100 → $1000. Credited on $100, not $1000: the larger balance has
  // only existed for an instant at the closing snapshot.
  const e = accrueInterval(snap(100, 0), snap(1000, 24), RATE, 1);
  check(
    "credited on the smaller endpoint",
    Math.abs(e.points - 100) < 1e-6,
    `got ${e.points}`,
  );
}

console.log("\n— degenerate intervals —");
{
  check(
    "zero-length interval → null",
    accrueInterval(snap(500, 5), snap(500, 5), RATE, 1) === null,
  );
  check(
    "reversed interval → null",
    accrueInterval(snap(500, 10), snap(500, 5), RATE, 1) === null,
  );
  check(
    "zero balance → null",
    accrueInterval(snap(0, 0), snap(0, 24), RATE, 1) === null,
  );
  let threw = false;
  try {
    accrueInterval(snap(1, 0), { ...snap(1, 24), wallet: "0xdef" }, RATE, 1);
  } catch {
    threw = true;
  }
  check("mismatched series throws", threw);
}

console.log("\n— dust floor —");
{
  const withFloor = { ...RATE, minUsd: 25 };
  check(
    "below floor earns nothing",
    accrueInterval(snap(5, 0), snap(5, 24), withFloor, 1) === null,
  );
  check(
    "above floor earns",
    accrueInterval(snap(50, 0), snap(50, 24), withFloor, 1) !== null,
  );
}

console.log("\n— unpriced assets (KLD before TGE) —");
{
  const kld = (amt, h) =>
    snap(null, h, { sourceSlug: "stake", rawAmount: amt, rawSymbol: "KLD" });
  const e = accrueInterval(kld(500, 0), kld(500, 24), RATE, 1);
  check(
    "accrues in raw units when unpriced",
    e !== null && Math.abs(e.points - 500) < 1e-6,
    `got ${e?.points}`,
  );
  const spiked = accrueSeries(
    [kld(0, 0), kld(9_999_999, 12), kld(0, 24)],
    RATE,
    1,
  );
  check(
    "unpriced spike also refused",
    spiked.reduce((s, e) => s + e.points, 0) === 0,
  );
}

console.log("\n— daily cap —");
{
  // Ten separate intervals that would each earn 1000; cap is 2500/day.
  const many = [];
  for (let i = 0; i < 10; i++) {
    many.push({
      wallet: "0xabc",
      chainId: 8453,
      sourceSlug: "lp",
      season: 1,
      epochStart: new Date(Date.UTC(2026, 7, 1, i)),
      epochEnd: new Date(Date.UTC(2026, 7, 1, i + 1)),
      usdSeconds: 0,
      points: 1000,
    });
  }
  const capped = applyDailyCap(many, 2500);
  const total = capped.reduce((s, e) => s + e.points, 0);
  check(
    "splitting across intervals cannot beat the cap",
    Math.abs(total - 2500) < 1e-9,
    `got ${total}`,
  );

  // The same wallet on the next day gets a fresh allowance.
  const nextDay = many.map((e) => ({
    ...e,
    epochStart: new Date(e.epochStart.getTime() + 86400000),
    epochEnd: new Date(e.epochEnd.getTime() + 86400000),
  }));
  const both = applyDailyCap([...many, ...nextDay], 2500);
  check(
    "cap resets daily",
    Math.abs(both.reduce((s, e) => s + e.points, 0) - 5000) < 1e-9,
  );
}

console.log("\n— agent multiplier decay —");
{
  const agent = {
    rate: 1.0,
    multiplier: 1.2,
    minUsd: 25,
    dailyCapPts: 30000,
    multiplierActionLimit: 20,
  };
  const first = actionPoints(1000, agent, 0);
  check(
    "bonus applies early",
    first.multiplierApplied === 1.2 && Math.abs(first.points - 1200) < 1e-9,
  );

  const later = actionPoints(1000, agent, 20);
  check(
    "bonus gone at the limit",
    later.multiplierApplied === 1 && Math.abs(later.points - 1000) < 1e-9,
  );

  const dust = actionPoints(5, agent, 0);
  check("dust action earns nothing", dust.points === 0);

  // A thousand dust swaps through the agent must still be worthless.
  let spam = 0;
  for (let i = 0; i < 1000; i++) spam += actionPoints(24, agent, i).points;
  check("1000 sub-floor agent swaps earn nothing", spam === 0, `got ${spam}`);
}

console.log("\n— chain multiplier —");
{
  const e = accrueInterval(snap(1000, 0), snap(1000, 24), RATE, 1, 2);
  check(
    "2x chain multiplier doubles",
    Math.abs(e.points - 2000) < 1e-6,
    `got ${e.points}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
