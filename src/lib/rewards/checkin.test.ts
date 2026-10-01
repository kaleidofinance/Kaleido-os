/** Run: npx tsx src/lib/rewards/checkin.test.ts */
import {
  CHECKIN_POINTS,
  checkinMessage,
  checkinTxHash,
  currentStreak,
  dayOfCheckinHash,
  earnsStreakBonus,
  msUntilNextUtcDay,
  streakBonusTxHash,
  streakEndingOn,
  utcDay,
} from "./checkin";

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

check("daily amount is 25", CHECKIN_POINTS === 25);
const W = "0x" + "a".repeat(40);
check("parses a check-in row's day", dayOfCheckinHash(checkinTxHash(W, "2026-10-01")) === "2026-10-01");
check("a streak-bonus row is not a check-in day", dayOfCheckinHash(streakBonusTxHash(W, "2026-10-01")) === null);
const week = ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"];
check("7 consecutive days → streak 7", streakEndingOn(week, "2026-10-01") === 7);
check("a gap resets the streak", streakEndingOn(["2026-09-28", "2026-09-30", "2026-10-01"], "2026-10-01") === 2);
check("not checked in that day → 0", streakEndingOn(week, "2026-10-02") === 0);
check("streak crosses a month boundary", streakEndingOn(["2026-09-30", "2026-10-01"], "2026-10-01") === 2);
check("current streak survives until tonight (ends yesterday)", currentStreak(week, "2026-10-02") === 7);
check("current streak is 0 after a missed day", currentStreak(week, "2026-10-03") === 0);
check("bonus on day 7 and 14, not 6/8/0", earnsStreakBonus(7) && earnsStreakBonus(14) && !earnsStreakBonus(6) && !earnsStreakBonus(8) && !earnsStreakBonus(0));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
