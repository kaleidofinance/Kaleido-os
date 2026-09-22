import { projectWaitlistRewards } from "./rewards";

let pass = 0;
let fail = 0;
const check = (name: string, condition: boolean) => {
  if (condition) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
};

const now = Date.parse("2026-01-01T06:00:00.000Z");
const pending = projectWaitlistRewards(
  {
    welcome_points: 100,
    activated_at: null,
    x_linked_at: "2026-01-01T04:00:00.000Z",
  },
  1,
  now,
);
check("unactivated welcome and referral points are available", pending.availablePoints === 150);
check("an X task inside its hold is pending", pending.pendingPoints === 100);
check("pending task has a five-hour unlock time", pending.tasks[0].availableAt === "2026-01-01T09:00:00.000Z");

const activated = projectWaitlistRewards(
  {
    welcome_points: 100,
    activated_at: "2026-01-01T00:00:00.000Z",
    x_linked_at: "2026-01-01T00:00:00.000Z",
    arc_mainnet_tx_at: "2026-01-01T01:00:00.000Z",
  },
  0,
  now,
);
check("activated settled task is marked settled", activated.tasks[5].status === "settled");
check("an expired X hold is available for reconciliation", activated.availablePoints === 100);
check("an activated X hold is no longer pending", activated.pendingPoints === 0);

const held = projectWaitlistRewards(
  {
    welcome_points: 100,
    activated_at: "2026-01-01T00:00:00.000Z",
    x_followed_at: "2026-01-01T00:00:00.000Z", // follow counts (expired hold)
    x_retweeted_at: "2026-01-01T00:00:00.000Z", // HELD
    x_commented_at: "2026-01-01T00:00:00.000Z", // HELD
  },
  0,
  now,
);
check("retweet is flagged held", held.tasks.find((x) => x.key === "retweeted")?.held === true);
check("comment is flagged held", held.tasks.find((x) => x.key === "commented")?.held === true);
check("follow is not held", held.tasks.find((x) => x.key === "followed")?.held === false);
check("held retweet+comment are excluded; only follow (100) is available", held.availablePoints === 100);

const heldOnly = projectWaitlistRewards(
  {
    welcome_points: 100,
    activated_at: "2026-01-01T00:00:00.000Z",
    x_retweeted_at: "2026-01-01T00:00:00.000Z", // HELD
    x_commented_at: "2026-01-01T00:00:00.000Z", // HELD
  },
  0,
  now,
);
check("a wallet whose only X tasks are held earns 0 available X points", heldOnly.availablePoints === 0);
check("held-only tasks are not pending either", heldOnly.pendingPoints === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
