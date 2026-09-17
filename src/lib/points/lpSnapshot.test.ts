/**
 * The in-range LP valuation: the "in-range only" gate and the per-owner sum.
 * Run with `npx tsx src/lib/points/lpSnapshot.test.ts`.
 */
import { isInRange, positionUsd, usdByOwner, type RawPosition } from "./lpSnapshot.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${got}`}`); }
};

/** sqrtPriceX96 at tick 0 is exactly 2^96. */
const SQRT_AT_TICK0 = 2n ** 96n;

const pos = (over: Partial<RawPosition> = {}): RawPosition => ({
  tokenId: 1n,
  owner: "0x1111111111111111111111111111111111111111",
  token0: "0xaaa",
  token1: "0xbbb",
  decimals0: 18,
  decimals1: 18,
  tickLower: -887220,
  tickUpper: 887220,
  liquidity: 10n ** 18n,
  ...over,
});

console.log("\n— isInRange (half-open [lower, upper)) —");
{
  check("at the lower tick is in range", isInRange(-100, -100, 100));
  check("strictly below the upper is in range", isInRange(99, -100, 100));
  check("at the upper tick is OUT (half-open)", isInRange(100, -100, 100) === false);
  check("below the range is out", isInRange(-101, -100, 100) === false);
}

console.log("\n— positionUsd —");
{
  const pool = { tick: 0, sqrtPriceX96: SQRT_AT_TICK0 };
  const inRange = positionUsd({ position: pos(), pool, price0: 1, price1: 1 });
  check("an in-range position with both prices is worth > 0", inRange > 0, String(inRange));

  // Value scales linearly with price — a proportionality check that does not pin
  // the exact V3 amount math (which positionValue.ts already tests).
  const doubled = positionUsd({ position: pos(), pool, price0: 2, price1: 2 });
  check("doubling both prices doubles the value",
    Math.abs(doubled - 2 * inRange) < 1e-6, `${doubled} vs ${2 * inRange}`);

  // Out of range → 0 (the whole point of the gate).
  const outHigh = positionUsd({
    position: pos({ tickLower: -100, tickUpper: 100 }),
    pool: { tick: 500, sqrtPriceX96: SQRT_AT_TICK0 },
    price0: 1, price1: 1,
  });
  check("an out-of-range position earns 0", outHigh === 0, String(outHigh));

  check("an empty (0-liquidity) position earns 0",
    positionUsd({ position: pos({ liquidity: 0n }), pool, price0: 1, price1: 1 }) === 0);
  check("no prices → 0 (never guessed)",
    positionUsd({ position: pos(), pool, price0: null, price1: null }) === 0);
}

console.log("\n— usdByOwner —");
{
  const A = "0xAAaAAA0000000000000000000000000000000001";
  const B = "0xbbBBbb0000000000000000000000000000000002";
  const m = usdByOwner([
    { owner: A, usd: 100 },
    { owner: A.toLowerCase(), usd: 50 },   // same owner, different case → summed
    { owner: B, usd: 25 },
    { owner: B, usd: 0 },                    // zero contributions dropped
  ]);
  check("a wallet's positions sum, case-insensitively", m.get(A.toLowerCase()) === 150, JSON.stringify([...m]));
  check("a second wallet is tracked separately", m.get(B.toLowerCase()) === 25, JSON.stringify([...m]));
  check("only wallets with liquidity get a row", m.size === 2, String(m.size));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
