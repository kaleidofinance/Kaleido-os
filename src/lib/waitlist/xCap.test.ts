import {
  X_TASK_CAP,
  CAPPED_X_TASKS,
  isCappedColumn,
} from "./xCap";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

check("the cap is 1,000 claims", X_TASK_CAP === 1000);

// Only the self-attested tasks are capped. linked (real OAuth) and followed
// (its claim count matched the real follower count) must NOT be capped, or the
// cap would lock genuine verified users out.
const capped = Object.keys(CAPPED_X_TASKS).sort();
check(
  "exactly retweeted + commented + launch are capped",
  JSON.stringify(capped) === JSON.stringify(["commented", "launch", "retweeted"]),
);
check("linked is not capped", !("linked" in CAPPED_X_TASKS));
check("followed is not capped", !("followed" in CAPPED_X_TASKS));

// The columns the write path checks membership against.
check("retweet column is capped", isCappedColumn("x_retweeted_at"));
check("comment column is capped", isCappedColumn("x_commented_at"));
check("launch column is capped", isCappedColumn("x_launch_at"));
check("follow column is NOT capped", !isCappedColumn("x_followed_at"));
check("link column is NOT capped", !isCappedColumn("x_linked_at"));
check("an unknown column is not capped", !isCappedColumn("x_bitget_at"));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
