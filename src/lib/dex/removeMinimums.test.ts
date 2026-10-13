/*
 * removeMinimums — the slippage floors for a liquidity removal. Run with
 * `npx tsx src/lib/dex/removeMinimums.test.ts`.
 *
 * The safety property this guards: the floor must ALWAYS sit below the amount the
 * pool actually returns, so a real removal is never bricked; it only reverts on a
 * large adverse move. So the cases check the math is right in each price regime,
 * and — the load-bearing one — that the floor is strictly below the un-cut amount.
 */
import { removeMinimums } from "./liquidity.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got ? " " + got : ""}`);
  }
};

/* sqrtPriceX96 for a tick, by the same identity removeMinimums uses, so the
   test's price and the function's tick math are in one frame. */
const Q96 = 2 ** 96;
const sqrtX96 = (tick: number) =>
  BigInt(Math.floor(Math.pow(1.0001, tick / 2) * Q96)).toString();

const L = "1000000000000000"; // 1e15, a plausible uint128 liquidity
const LOWER = -6000;
const UPPER = 6000;

function main() {
  console.log("\n— a position entirely on one side holds one token —");

  {
    // Price at (or below) the lower bound: all token0, so token1's floor is 0.
    const r = removeMinimums({
      liquidity: L,
      sqrtPriceX96: sqrtX96(LOWER),
      tickLower: LOWER,
      tickUpper: UPPER,
      slippageBps: 50,
    });
    check(
      "price at the lower bound → all token0, token1 floor is 0",
      r.amount1Min === "0" && BigInt(r.amount0Min) > 0n,
      JSON.stringify(r),
    );
  }

  {
    // Price at (or above) the upper bound: all token1, so token0's floor is 0.
    const r = removeMinimums({
      liquidity: L,
      sqrtPriceX96: sqrtX96(UPPER),
      tickLower: LOWER,
      tickUpper: UPPER,
      slippageBps: 50,
    });
    check(
      "price at the upper bound → all token1, token0 floor is 0",
      r.amount0Min === "0" && BigInt(r.amount1Min) > 0n,
      JSON.stringify(r),
    );
  }

  console.log("\n— in range, both tokens have a floor —");

  const mid = removeMinimums({
    liquidity: L,
    sqrtPriceX96: sqrtX96(0), // mid of a symmetric range
    tickLower: LOWER,
    tickUpper: UPPER,
    slippageBps: 50,
  });
  check(
    "a price inside the range floors both tokens",
    BigInt(mid.amount0Min) > 0n && BigInt(mid.amount1Min) > 0n,
    JSON.stringify(mid),
  );

  console.log("\n— the floor sits BELOW the true amount (never bricks) —");

  {
    // The true (un-cut) amounts by the same identity, so we can prove the floor
    // is below them. sP = 1 (tick 0), sA = 1.0001^-3000, sB = 1.0001^3000.
    const Ln = Number(L);
    const sA = Math.pow(1.0001, LOWER / 2);
    const sB = Math.pow(1.0001, UPPER / 2);
    const sP = 1; // tick 0
    const trueAmount0 = (Ln * (sB - sP)) / (sP * sB);
    const trueAmount1 = Ln * (sP - sA);
    check(
      "token0 floor < true token0 amount",
      Number(mid.amount0Min) < trueAmount0,
      `${mid.amount0Min} vs ${trueAmount0}`,
    );
    check(
      "token1 floor < true token1 amount",
      Number(mid.amount1Min) < trueAmount1,
      `${mid.amount1Min} vs ${trueAmount1}`,
    );
  }

  console.log("\n— higher slippage lowers the floor —");

  const tight = removeMinimums({ liquidity: L, sqrtPriceX96: sqrtX96(0), tickLower: LOWER, tickUpper: UPPER, slippageBps: 10 });
  const loose = removeMinimums({ liquidity: L, sqrtPriceX96: sqrtX96(0), tickLower: LOWER, tickUpper: UPPER, slippageBps: 500 });
  check(
    "a wider slippage yields a lower floor",
    BigInt(loose.amount0Min) < BigInt(tight.amount0Min),
    `${loose.amount0Min} < ${tight.amount0Min}`,
  );

  console.log("\n— it falls back to 0 rather than risk a bad floor —");

  check(
    "no sqrtPriceX96 → no floor",
    removeMinimums({ liquidity: L, sqrtPriceX96: undefined, tickLower: LOWER, tickUpper: UPPER, slippageBps: 50 }).amount0Min === "0",
  );
  check(
    "zero liquidity → no floor",
    removeMinimums({ liquidity: "0", sqrtPriceX96: sqrtX96(0), tickLower: LOWER, tickUpper: UPPER, slippageBps: 50 }).amount0Min === "0",
  );
  check(
    "an inverted range → no floor",
    removeMinimums({ liquidity: L, sqrtPriceX96: sqrtX96(0), tickLower: UPPER, tickUpper: LOWER, slippageBps: 50 }).amount0Min === "0",
  );

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
