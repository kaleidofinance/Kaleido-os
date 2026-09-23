/**
 * summarizeSwapCredits — the 24h/7d credit-count + volume fold behind the admin
 * swap-pipeline panel. Pure; `nowMs` is injected so the windows are deterministic.
 * Run with `npx tsx src/lib/analytics/adminSwap.test.ts`.
 */
import { summarizeSwapCredits } from "./admin.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${got}`}`); }
};

const NOW = Date.parse("2026-09-23T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();

console.log("\n— windows —");
{
  const rows = [
    { occurred_at: ago(1), usd_value: 10 },   // 24h + 7d
    { occurred_at: ago(23), usd_value: 40 },  // 24h + 7d
    { occurred_at: ago(48), usd_value: 100 }, // 7d only
    { occurred_at: ago(24 * 8), usd_value: 5 }, // outside both
  ];
  const r = summarizeSwapCredits(rows, NOW);
  check("credits24h counts only the last 24h", r.credits24h === 2, String(r.credits24h));
  check("credits7d counts the last 7 days", r.credits7d === 3, String(r.credits7d));
  check("volume24hUsd sums only the 24h rows", r.volume24hUsd === 50, String(r.volume24hUsd));
}

console.log("\n— boundaries + junk —");
{
  const r = summarizeSwapCredits(
    [
      { occurred_at: ago(24), usd_value: 7 },   // exactly 24h → counts
      { occurred_at: ago(24 * 7), usd_value: 3 }, // exactly 7d → 7d only
    ],
    NOW,
  );
  check("exactly 24h ago still in 24h", r.credits24h === 1, String(r.credits24h));
  check("exactly 7d ago still in 7d", r.credits7d === 2, String(r.credits7d));
}
{
  const r = summarizeSwapCredits(
    [
      { occurred_at: null, usd_value: 9 },
      { occurred_at: "not-a-date", usd_value: 9 },
      { occurred_at: ago(2), usd_value: null },
      { occurred_at: ago(2), usd_value: "-5" },
    ],
    NOW,
  );
  check("bad timestamps are skipped", r.credits24h === 2, String(r.credits24h));
  check("null / negative usd_value adds no volume", r.volume24hUsd === 0, String(r.volume24hUsd));
}
{
  const r = summarizeSwapCredits([], NOW);
  check("empty → all zero", r.credits24h === 0 && r.credits7d === 0 && r.volume24hUsd === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
