/*
 * Checks on the health monitor's one pure decision. Run with `npm run test:health`.
 *
 * `shouldWarn` is the whole cooldown, and it is the part of lib/health/monitor.ts
 * a mistake in is invisible from the outside. The two failure directions are not
 * symmetric, which is why they get separate sections below:
 *
 *   • over-eager sends a duplicate. Annoying, and the way a user turns off the one
 *     notification category they should keep on.
 *   • over-cautious withholds a liquidation warning. That is the failure the whole
 *     file exists to prevent, and nothing downstream can detect it — a warning
 *     that was never sent leaves no trace anywhere.
 *
 * The rest of the module is I/O against five chains and Supabase, so it is checked
 * by pointing the route at `?dryRun=1` rather than by mocking a provider. What is
 * asserted here is the arithmetic those reads feed.
 */
import { shouldWarn, COOLDOWN_MS, WARN_AT, WORSENED_BY } from "./monitor";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const never = undefined;

console.log("\n— the threshold —");
{
  check("a healthy position is not warned", !shouldWarn(2.4, never, NOW));
  check(
    "and neither is one just above the line",
    !shouldWarn(WARN_AT + 0.001, never, NOW),
  );
  check("at the line it is", shouldWarn(WARN_AT, never, NOW));
  check("below it, certainly", shouldWarn(1.001, never, NOW));
  /* The threshold is the client's, deliberately — two surfaces disagreeing about
     what counts as dangerous is how a user gets a push saying they are at risk and
     a portfolio page saying they are fine. */
  check(
    "the threshold is the client's 1.05",
    WARN_AT === 1.05,
    String(WARN_AT),
  );
}

console.log("\n— a level below 1.0 is still warned —");
{
  /* Liquidatable, not liquidated. The keeper on that chain may be behind, the
     price may recover, and a borrower can still repay — so this is the most
     important warning in the set, not one to treat as too late to bother with. */
  check("0.98 warns", shouldWarn(0.98, never, NOW));
  check("0.4 warns", shouldWarn(0.4, never, NOW));
  /* Zero, however, is what useGetValueAndHealth documents as the value a FAILED
     read used to write. The monitor never passes it — an unreadable factor is
     `null` and counted as a failure, not as a health factor of zero — and this
     pins that `shouldWarn` would treat it as maximally unhealthy if it ever did,
     so the mistake shows up as a duplicate rather than as silence. */
  check(
    "and 0 would warn rather than be read as 'no data'",
    shouldWarn(0, never, NOW),
  );
}

console.log("\n— the cooldown —");
{
  const warnedJustNow = { last_warned_at: ago(60_000), last_health: 1.04 };
  check(
    "a repeat inside the window is silent",
    !shouldWarn(1.04, warnedJustNow, NOW),
  );
  check(
    "even if the position improved slightly but is still in the band",
    !shouldWarn(1.045, warnedJustNow, NOW),
  );
  check(
    "past the window it warns again",
    shouldWarn(
      1.04,
      { last_warned_at: ago(COOLDOWN_MS + 1000), last_health: 1.04 },
      NOW,
    ),
  );
  check(
    "exactly at the window it warns",
    shouldWarn(
      1.04,
      { last_warned_at: ago(COOLDOWN_MS), last_health: 1.04 },
      NOW,
    ),
  );
  check(
    "the window is six hours",
    COOLDOWN_MS === 6 * 60 * 60 * 1000,
    String(COOLDOWN_MS),
  );
}

console.log("\n— a deterioration beats the cooldown —");
{
  /* Without this the cooldown is a gag: warn once at 1.04 and say nothing while
     the position walks to 1.001. */
  const warnedAt104 = { last_warned_at: ago(60_000), last_health: 1.04 };
  check(
    "a slide past the margin re-warns inside the window",
    shouldWarn(1.04 - WORSENED_BY, warnedAt104, NOW),
  );
  check("and further still, obviously", shouldWarn(1.001, warnedAt104, NOW));
  check(
    "but noise inside the margin does not",
    !shouldWarn(1.04 - WORSENED_BY / 2, warnedAt104, NOW),
  );
  check("the margin is 0.02", WORSENED_BY === 0.02, String(WORSENED_BY));
}

console.log("\n— missing and malformed state —");
{
  check("no row at all warns", shouldWarn(1.02, never, NOW));
  check(
    "a row that was only ever a liveness check warns",
    /* last_check_at is written for every wallet looked at, so a row can exist with
       last_warned_at still null. Reading that as "already warned" would silence a
       first warning permanently — the worst single bug available in this file. */
    shouldWarn(1.02, { last_warned_at: null, last_health: null }, NOW),
  );
  check(
    "an unparseable timestamp warns rather than silences",
    shouldWarn(1.02, { last_warned_at: "not a date", last_health: 1.03 }, NOW),
  );
  check(
    "a warned row with no recorded level stays silent inside the window",
    /* Nothing to compare against, so the deterioration escape hatch cannot fire.
       Silent is right here: the cooldown is doing its job and the next run past
       the window will warn regardless. */
    !shouldWarn(1.0, { last_warned_at: ago(60_000), last_health: null }, NOW),
  );
  check(
    "a future timestamp does not warn — clock skew is not a deterioration",
    !shouldWarn(
      1.04,
      {
        last_warned_at: new Date(NOW + 60_000).toISOString(),
        last_health: 1.04,
      },
      NOW,
    ),
  );
}

console.log("\n— health always gates first —");
{
  /* Whatever the state says, a healthy position is never warned about. Pinned
     because the cheap way to write this function is to check the state first and
     return early, which would warn a recovered position that had been warned about
     six hours ago. */
  check(
    "an old warning does not re-fire on a recovered position",
    !shouldWarn(
      3.0,
      { last_warned_at: ago(COOLDOWN_MS + 1000), last_health: 1.01 },
      NOW,
    ),
  );
  check(
    "and a deterioration that is still healthy is not a warning",
    !shouldWarn(2.0, { last_warned_at: ago(60_000), last_health: 2.5 }, NOW),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
