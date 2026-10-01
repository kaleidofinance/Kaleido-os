/** Run: npx tsx src/lib/rewards/checkin.test.ts */
import { checkinMessage, checkinTxHash, msUntilNextUtcDay, utcDay } from "./checkin";

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, d = "") => {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${d ? " — " + d : ""}`); }
};

const late = new Date("2026-10-01T23:59:59Z");
const early = new Date("2026-10-02T00:00:01Z");
check("UTC day is calendar date", utcDay(late) === "2026-10-01", utcDay(late));
check("rolls over at UTC midnight", utcDay(early) === "2026-10-02", utcDay(early));
check("one tx hash per wallet per day (case-insensitive)",
  checkinTxHash("0xABC", "2026-10-01") === checkinTxHash("0xabc", "2026-10-01"));
check("a new day is a new tx hash",
  checkinTxHash("0xabc", "2026-10-01") !== checkinTxHash("0xabc", "2026-10-02"));
check("message names wallet and day",
  checkinMessage("0xABC", "2026-10-01") === "Kaleido daily check-in for wallet 0xabc on 2026-10-01.");
check("1s before midnight → 1s to next day", msUntilNextUtcDay(late) === 1000, String(msUntilNextUtcDay(late)));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
