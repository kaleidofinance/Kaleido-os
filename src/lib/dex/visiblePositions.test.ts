/*
 * Which positions the Positions page lists. Run with `npm run test:visiblepositions`.
 * The regression: a fully-removed position whose collect never landed still
 * holds its tokens, and the page hid it (and its Collect button).
 */
import {
  positionsToShow,
  isClosedWithFees,
  owedAmounts,
} from "./visiblePositions.ts";

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

const pos = (
  id: string,
  liquidity: string,
  owed: [string, string] = ["0", "0"],
  live?: [string | null, string | null],
) => ({
  id,
  liquidity,
  tokensOwed0: owed[0],
  tokensOwed1: owed[1],
  uncollectedFees0: live ? live[0] : null,
  uncollectedFees1: live ? live[1] : null,
});

const open = pos("open", "1000");
const openNoFees = pos("open0", "5");
const closedOwed = pos("closedOwed", "0", ["123", "0"]);
const closedLiveOnly = pos("closedLive", "0", ["0", "0"], ["0", "7"]);
const swept = pos("swept", "0");
const sweptLiveZero = pos("sweptLive", "0", ["0", "0"], ["0", "0"]);

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join(",");

console.log("\n— which positions are listed —");
const shown = positionsToShow([closedOwed, open, swept, openNoFees, closedLiveOnly, sweptLiveZero]);
check(
  "open positions first, then closed ones still owed tokens; swept ones dropped",
  ids(shown) === "open,open0,closedOwed,closedLive",
  ids(shown),
);
check("an open position with no fees is still listed", shown.some((p) => p.id === "open0"));
check("a closed position whose collect never landed is listed", isClosedWithFees(closedOwed));
check("the live figure alone keeps a closed position listed", isClosedWithFees(closedLiveOnly));
check("a fully swept closed position is not listed", !isClosedWithFees(swept) && !isClosedWithFees(sweptLiveZero));
check("an open position is never 'closed with fees'", !isClosedWithFees(pos("o", "1", ["9", "9"])));
check("no positions → nothing listed", positionsToShow([]).length === 0);

console.log("\n— what a collect would pay —");
{
  const [a, b] = owedAmounts(pos("x", "0", ["5", "6"], ["50", null]));
  check("prefers the live figure, falls back per token to the checkpoint", a === 50n && b === 6n, `${a},${b}`);
  const [c, d] = owedAmounts({ liquidity: "0", tokensOwed0: "garbage", tokensOwed1: "" });
  check("unparseable amounts read as 0, not a throw", c === 0n && d === 0n);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
