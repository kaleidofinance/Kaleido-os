// Checks on the amount arithmetic behind the pools table's Deposit modal.
// Run with `npx tsx src/lib/dex/deposit.test.ts`.
//
// These three functions decide what goes into the second box when the reader
// types in the first, and every way they fail is quiet. A ratio applied the wrong
// way round still fills the box with a plausible number; a string with one digit
// too many for a 6-decimal token throws inside `parseUnits` two screens later,
// after two approvals have been signed; and a trailing-zero strip that eats a
// zero turns 100 USDC into 1.
//
// What is under test, in order of how badly it fails when wrong:
//
//   1. The output being parseable at all. `pairedAmount` feeds an input box whose
//      value is later handed to `ethers.parseUnits` with the token's own
//      decimals, and a float ratio produces 17 fractional digits by default.
//      Tests 1 and 3 run the results back through parseUnits.
//   2. The direction of the ratio. token1-per-token0 multiplied on the wrong leg
//      is off by ratio², which for a 3000 WETH/USDC pool is seven orders of
//      magnitude — and still a number. Test 2.
//   3. Zeros and infinities. A V3 range entirely off the market gives a ratio of
//      0 or Infinity, which are legitimate answers meaning "this side takes
//      nothing"; they must not reach the box as "0", "Infinity" or "NaN". Test 2.
//   4. Mixed decimals in the reserve ratio. USDC/WETH is 6/18, and reading the
//      raw reserves without scaling is wrong by 10^12 while still being finite.
//      Test 4.
//   5. `increaseV3`'s order of operations. Test 6, and the one thing in this file
//      that is about a sequence rather than a number: the function's whole reason
//      for putting the slippage floor before the two approvals is that a refusal
//      arriving after them has cost the user two signatures to be told no. That
//      ordering is invisible in the return value, so the refusal cases run with a
//      signer that throws on contact — if an approval ever moves back in front of
//      the floor, they fail loudly instead of silently costing gas.

import { ethers } from "ethers";
import {
  deadlineIn20Minutes,
  increaseV3,
  pairedAmount,
  reserveRatio,
  trimAmount,
} from "./deposit";
import type { IToken } from "@/constants/types/dex";

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

const parseable = (value: string, decimals: number) => {
  try {
    ethers.parseUnits(value, decimals);
    return true;
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------------ 1 -- */
/* trimAmount. The regression the second case pins: stripping /\.?0+$/ from a
   string with no decimal point at all turns "100" into "1". */
check("a whole number keeps its zeros", trimAmount(100, 6) === "100");
check("1000 is not 1", trimAmount(1000, 18) === "1000");
check("a trailing zero goes", trimAmount(1.2, 18) === "1.2");
check("only trailing zeros go", trimAmount(1.02, 18) === "1.02");
check("a third of a unit fits USDC", trimAmount(1 / 3, 6) === "0.333333");
check(
  "an 18-decimal token is capped at eight places",
  trimAmount(1 / 3, 18) === "0.33333333",
  trimAmount(1 / 3, 18),
);
check("below a token's resolution is empty, not zero", trimAmount(1e-9, 6) === "");
check("zero is empty", trimAmount(0, 6) === "");
check("negative is empty", trimAmount(-5, 6) === "");
check("NaN is empty", trimAmount(NaN, 6) === "");
check("Infinity is empty", trimAmount(Infinity, 18) === "");
for (const [n, d] of [
  [1 / 3, 6],
  [1 / 7, 18],
  [2 / 3, 8],
  [1234.56789, 6],
] as const) {
  check(
    `trimAmount(${n}, ${d}) is parseable`,
    parseable(trimAmount(n, d), d),
    trimAmount(n, d),
  );
}

/* ------------------------------------------------------------------ 2 -- */
/* pairedAmount. `ratio` is token1 per token0, so typing into leg 0 multiplies
   and typing into leg 1 divides. Swap those and a 3000 WETH/USDC pool asks for
   9,000,000 USDC beside one WETH. */
check(
  "typing token0 multiplies by the ratio",
  pairedAmount({ value: "2", from: "0", ratio: 3000, decimals: 6 }) === "6000",
);
check(
  "typing token1 divides by the ratio",
  pairedAmount({ value: "6000", from: "1", ratio: 3000, decimals: 18 }) === "2",
);
check(
  "the two directions round-trip",
  pairedAmount({
    value: pairedAmount({ value: "1", from: "0", ratio: 0.9994, decimals: 6 }),
    from: "1",
    ratio: 0.9994,
    decimals: 6,
  }) === "1",
);
check(
  "a ratio of zero fills nothing",
  pairedAmount({ value: "1", from: "0", ratio: 0, decimals: 6 }) === "",
);
check(
  "an infinite ratio fills nothing",
  pairedAmount({ value: "1", from: "0", ratio: Infinity, decimals: 6 }) === "",
);
check(
  "no ratio fills nothing",
  pairedAmount({ value: "1", from: "0", ratio: null, decimals: 6 }) === "",
);
check(
  "an empty box pairs with an empty box",
  pairedAmount({ value: "", from: "0", ratio: 2, decimals: 6 }) === "",
);
check(
  "a typed zero pairs with nothing",
  pairedAmount({ value: "0", from: "0", ratio: 2, decimals: 6 }) === "",
);
check(
  "a half-typed decimal point is not NaN",
  pairedAmount({ value: ".", from: "0", ratio: 2, decimals: 6 }) === "",
);

/* ------------------------------------------------------------------ 3 -- */
/* The awkward real case: an odd ratio into a 6-decimal token. */
const odd = pairedAmount({ value: "1", from: "0", ratio: 1 / 3, decimals: 6 });
check("an odd ratio is truncated to the token", odd === "0.333333", odd);
check("and is parseable", parseable(odd, 6));

/* ------------------------------------------------------------------ 4 -- */
/* reserveRatio, on the pair the decimals bite hardest: 1 WETH against 3000 USDC
   is a ratio of 3000, and the raw reserves differ by 10^12 before scaling. */
const ONE_WETH = ethers.parseUnits("1", 18).toString();
const USDC_3000 = ethers.parseUnits("3000", 6).toString();
const ratio = reserveRatio({
  reserve0: ONE_WETH,
  reserve1: USDC_3000,
  decimals0: 18,
  decimals1: 6,
});
check("mixed decimals scale before dividing", ratio === 3000, String(ratio));
const inverted = reserveRatio({
  reserve0: USDC_3000,
  reserve1: ONE_WETH,
  decimals0: 6,
  decimals1: 18,
});
check(
  "the other way round is the reciprocal",
  inverted !== null && Math.abs(inverted - 1 / 3000) < 1e-15,
  String(inverted),
);
check(
  "an empty pair has no ratio",
  reserveRatio({
    reserve0: "0",
    reserve1: "0",
    decimals0: 18,
    decimals1: 6,
  }) === null,
);
check(
  "one empty side has no ratio",
  reserveRatio({
    reserve0: ONE_WETH,
    reserve1: "0",
    decimals0: 18,
    decimals1: 6,
  }) === null,
);
check(
  "unparseable reserves have no ratio",
  reserveRatio({
    reserve0: "not a number",
    reserve1: "1",
    decimals0: 18,
    decimals1: 6,
  }) === null,
);
check(
  "numeric reserves are accepted as well as strings",
  reserveRatio({
    reserve0: 1000000,
    reserve1: 2000000,
    decimals0: 6,
    decimals1: 6,
  }) === 2,
);

/* ------------------------------------------------------------------ 5 -- */
/* The float derivation against the router's own integer quote.
 *
 * `_addLiquidity` computes `amountB = amountA * reserveB / reserveA` in uint256
 * and then requires the caller's minimum to be at or below it. The modal derives
 * the same number in float64 and floors it by 0.5%, so what has to hold is that
 * the float answer is nowhere near half a percent away from the integer one — not
 * that it is exact. Checked across three decimal pairings and four sizes.
 */
const quoteExact = (
  amountA: string,
  decA: number,
  decB: number,
  reserveA: string,
  reserveB: string,
) =>
  (ethers.parseUnits(amountA, decA) * BigInt(reserveB)) / BigInt(reserveA);

for (const [decA, decB, ra, rb] of [
  [18, 6, ethers.parseUnits("12.5", 18).toString(), ethers.parseUnits("37500", 6).toString()],
  [6, 6, ethers.parseUnits("1000000", 6).toString(), ethers.parseUnits("999123.456789", 6).toString()],
  [18, 18, ethers.parseUnits("7777.7777", 18).toString(), ethers.parseUnits("1.3", 18).toString()],
] as const) {
  const r = reserveRatio({
    reserve0: ra,
    reserve1: rb,
    decimals0: decA,
    decimals1: decB,
  });
  for (const amount of ["0.01", "1", "137.5", "999"]) {
    const derived = pairedAmount({
      value: amount,
      from: "0",
      ratio: r,
      decimals: decB,
    });
    const exact = quoteExact(amount, decA, decB, ra, rb);
    const mine = ethers.parseUnits(derived || "0", decB);
    /* Relative distance in bps, against the exact quote. Truncation to the
       token's decimals is a real and one-sided loss, so this is allowed to be
       under rather than only close. */
    const diff = exact > mine ? exact - mine : mine - exact;
    const withinHalfPct = exact === BigInt(0) || diff * BigInt(200) <= exact;
    check(
      `${amount} at ${decA}/${decB} lands inside the slippage floor`,
      withinHalfPct,
      `derived ${derived} vs exact ${exact}`,
    );
  }
}

/* ------------------------------------------------------------------ 6 -- */
/* increaseV3 — what reaches the position manager, and what never gets that far.
 *
 * The range and the amounts are lifted from build.test.ts's increase section on
 * purpose, so the two floors below are the same pair of numbers the agent's path
 * measures for the same band. A floor derived from the typed amounts instead of
 * from the range shows up here as a change in one of them, and it shows up in
 * both files at once rather than in whichever one nobody is running.
 */
const BAND = { tickLower: -202200, tickUpper: -200220 };
const SPOT = 1834.61; // USDC per WETH, inside the band
const EXPECTED_FLOORS = { amount0Min: "0.995", amount1Min: "1958.169197" };

const token = (symbol: string, decimals: number, address: string): IToken => ({
  address,
  name: symbol,
  symbol,
  decimals,
  verified: true,
});
const WETH = token("WETH", 18, "0x4200000000000000000000000000000000000006");
const USDC = token("USDC", 6, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const OWNER = "0x1111111111111111111111111111111111111111";
const MANAGER = "0x2222222222222222222222222222222222222222";

/** Every uint256 bit set — an allowance no deposit can exceed. */
const MAX_UINT256 = `0x${"f".repeat(64)}`;

/**
 * A signer that answers `allowance` with the maximum and refuses to sign.
 *
 * So the happy path needs no approval transaction, and an approval it should not
 * be sending surfaces as a thrown error rather than as a passing test.
 */
const readingSigner = (reads: string[]) =>
  ({
    call: async (tx: { data?: string }) => {
      reads.push((tx.data ?? "").slice(0, 10));
      return MAX_UINT256;
    },
    sendTransaction: async () => {
      throw new Error("increaseV3 sent a transaction through the signer");
    },
  }) as unknown as ethers.Signer;

/** A signer that fails on any contact at all, for the cases that must refuse first. */
const untouchableSigner = () =>
  ({
    call: async () => {
      throw new Error("increaseV3 read an allowance before it had a floor");
    },
    sendTransaction: async () => {
      throw new Error("increaseV3 signed before it had a floor");
    },
  }) as unknown as ethers.Signer;

type IncreaseArgs = [string, string, string, number, number, string, string, number];

const runIncrease = async (over: {
  signer: ethers.Signer;
  amount0?: string;
  amount1?: string;
  spot?: number | null;
}) => {
  const calls: IncreaseArgs[] = [];
  const result = await increaseV3({
    signer: over.signer,
    owner: OWNER,
    positionManager: MANAGER,
    tokenId: "7",
    token0: WETH,
    token1: USDC,
    amount0: over.amount0 ?? "1",
    amount1: over.amount1 ?? "2000",
    tickLower: BAND.tickLower,
    tickUpper: BAND.tickUpper,
    readSpot: async () => (over.spot === undefined ? SPOT : over.spot),
    increase: async (...args: IncreaseArgs) => {
      calls.push(args);
      return { wait: async () => null };
    },
  });
  return { result, calls };
};

/* Everything above is synchronous and has already run. From here down the checks
   await a write path, and a top-level await is not available — the suite is
   transformed to CJS. Same `main()` shape as build.test.ts and auditor.test.ts. */
async function main() {
  /* A position cannot exist without its pool, so a null spot is a failed read and
     not the "pool about to be created" case mintMinimums handles. Passing it
     through would floor the deposit at a ratio derived from the caller's own
     amounts — a floor that agrees with whatever was typed. */
  const noSpot = await runIncrease({ signer: untouchableSigner(), spot: null });
  check(
    "a pool whose price cannot be read is refused",
    noSpot.result !== null && /current price/.test(noSpot.result.error),
    JSON.stringify(noSpot.result),
  );
  check(
    "nothing is signed when the price is unreadable",
    noSpot.calls.length === 0,
  );

  /* The ordering claim, stated as a test: a zero leg is refused by mintMinimums,
     which runs before the approvals. With the untouchable signer, an approval
     moved back in front of the floor throws instead of passing. */
  const zeroLeg = await runIncrease({
    signer: untouchableSigner(),
    amount1: "0",
  });
  check(
    "a zero leg is refused before any allowance is read",
    zeroLeg.result !== null && zeroLeg.calls.length === 0,
    JSON.stringify(zeroLeg.result),
  );

  /* Amounts finer than the token, caught by parseBoth ahead of everything. */
  const tooPrecise = await runIncrease({
    signer: untouchableSigner(),
    amount1: "2000.1234567",
  });
  check(
    "an amount finer than USDC is refused before any allowance is read",
    tooPrecise.result !== null && /6 decimals/.test(tooPrecise.result.error),
    JSON.stringify(tooPrecise.result),
  );

  const reads: string[] = [];
  const ok = await runIncrease({ signer: readingSigner(reads) });
  check(
    "a good increase returns no error",
    ok.result === null,
    JSON.stringify(ok.result),
  );
  check("it calls increaseLiquidity exactly once", ok.calls.length === 1);
  check(
    "both legs' allowances are read",
    reads.length === 2 && reads.every((d) => d === "0xdd62ed3e"),
    reads.join(","),
  );

  if (ok.calls.length === 1) {
    const [tokenId, a0, a1, d0, d1, min0, min1, deadline] = ok.calls[0];
    check("the tokenId is carried", tokenId === "7");
    /* Amounts, decimals and floors must line up leg for leg. Every one of these
       is a pair of same-typed values in a positional call, so a swap
       type-checks, encodes and deposits the position upside down. */
    check("amount0 is the token0 leg", a0 === "1" && d0 === 18);
    check("amount1 is the token1 leg", a1 === "2000" && d1 === 6);
    check(
      "the floors are the ones this range implies",
      min0 === EXPECTED_FLOORS.amount0Min && min1 === EXPECTED_FLOORS.amount1Min,
      `${min0} / ${min1}`,
    );
    /* Neither floor may be the typed amount less the tolerance: the pool takes
       min(L(amount0), L(amount1)) and leaves the over-supplied side alone, so
       flooring both at 99.5% of what was typed reverts an honest deposit. Here
       the range sits below the market, so it consumes nearly all the WETH and
       under a fifth of the USDC. */
    check(
      "the over-supplied leg is floored well under what was typed",
      Number(min1) < 2000 * 0.995,
      min1,
    );
    const slack = deadline - deadlineIn20Minutes();
    check(
      "the deadline is twenty minutes out",
      Math.abs(slack) <= 5,
      String(slack),
    );
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
