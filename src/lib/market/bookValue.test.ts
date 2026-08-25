// Adversarial checks on the book valuation arithmetic. Run with plain node —
// no test runner in this repo. Mirrors src/lib/points/accrual.test.ts.
//
// The point of this file is that the strip's old numbers were wrong in a way
// `tsc` could never catch: correct types, nonsense arithmetic. Every case below
// has an answer worked out by hand.
import {
  foldBook,
  toWholeUnits,
  valueBook,
  type BookRow,
  type Currency,
} from "./bookValue.ts";

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
const near = (a: number | null, b: number, eps = 1e-6) =>
  a !== null && Math.abs(a - b) < eps;

/* The five lending currencies, as BORROW_CURRENCIES declares them. Checksummed
 * on purpose: the mirror tables hold lowercase log addresses, so every case here
 * also exercises case-insensitive matching. */
const ETH = "0x0000000000000000000000000000000000000001";
const USDC = "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3";
const USDT = "0x717A36E56b33585Bd00260422FfCc3270af34D3E";
const KFUSD = "0x913f3354942366809A05e89D288cCE60d87d7348";

const CURRENCIES: Currency[] = [
  { symbol: "ETH", address: ETH, decimals: 18 },
  { symbol: "USDC", address: USDC, decimals: 6 },
  { symbol: "USDT", address: USDT, decimals: 6 },
  { symbol: "kfUSD", address: KFUSD, decimals: 18 },
];

const PRICES: Record<string, number | null> = {
  ETH: 3000,
  USDC: 1,
  USDT: 1,
  kfUSD: 1,
  KLD: null,
};
const priceOf = (symbol: string) =>
  PRICES[symbol] === undefined ? null : PRICES[symbol];

const row = (tokenAddress: string | null, amount: string | null): BookRow => ({
  tokenAddress,
  amount,
});

const value = (rows: BookRow[], p = priceOf) =>
  valueBook(foldBook(rows, CURRENCIES), p);

/* Every case must satisfy this. It is the property the /leaderboard footnote
 * relies on: a total that excludes rows says how many. */
const coverageAddsUp = (c: {
  rows: number;
  valued: number;
  unpriced: number;
  unknownToken: number;
  malformedAmount: number;
}) => c.valued + c.unpriced + c.unknownToken + c.malformedAmount === c.rows;

console.log("\n— the bug this replaces —");
{
  // The exact case from the old hook: 1 USDC (1e6) + 1 ETH (1e18). `Number()`
  // summed these to 1000000000001000000 and rendered "$1,000,000,000,001,000,000".
  // Correct answer: 1 × $1 + 1 × $3000 = $3001.
  const { usd, coverage } = value([
    row(USDC.toLowerCase(), "1000000"),
    row(ETH, "1000000000000000000"),
  ]);
  check("1 USDC + 1 ETH → $3001", near(usd, 3001), `got ${usd}`);
  check(
    "not the concatenated nonsense",
    usd !== 1000000000001000000,
    `got ${usd}`,
  );
  check("both rows valued", coverage.valued === 2 && coverage.rows === 2);
  check("coverage adds up", coverageAddsUp(coverage));
}

console.log("\n— precision past float64 —");
{
  // 10,000,000 ETH in base units is 1e25, well past 2^53. Summing base units in
  // float64 loses the low digits; BigInt does not. Split across two rows so the
  // addition itself has to be exact.
  const half = "5000000000000000000000000"; // 5e24 wei = 5,000,000 ETH
  const { usd } = value([row(ETH, half), row(ETH, half)]);
  check("10,000,000 ETH → $30,000,000,000", near(usd, 3e10, 1), `got ${usd}`);

  // And the exact base-unit total survives the fold.
  const folded = foldBook([row(ETH, half), row(ETH, half)], CURRENCIES);
  check(
    "base units summed exactly",
    folded.totals[0].total === BigInt("10000000000000000000000000"),
    `got ${folded.totals[0].total}`,
  );
}

console.log("\n— decimals are declared, never inferred —");
{
  // Same integer, different tokens. 1e6 base units is $1 of USDC and
  // 0.000000000001 ETH. A shared 18dp assumption would price the USDC row at
  // $0.000000000003 and an 6dp assumption would price the ETH row at $3bn.
  const { usd } = value([row(USDC, "1000000"), row(USDT, "1000000")]);
  check("1e6 USDC + 1e6 USDT → $2", near(usd, 2), `got ${usd}`);

  const dust = value([row(ETH, "1000000")]);
  check("1e6 wei → $3e-9", near(dust.usd, 3e-9, 1e-15), `got ${dust.usd}`);
}

console.log("\n— rows that cannot be valued are counted, not guessed —");
{
  const KLD = "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505"; // not a lending currency
  const { usd, coverage } = value([
    row(USDC, "1000000"),
    row(KLD, "5000000000000000000"),
    row(null, "1000000"),
  ]);
  check("total covers only the known row", near(usd, 1), `got ${usd}`);
  check(
    "two rows flagged unknown",
    coverage.unknownToken === 2,
    JSON.stringify(coverage),
  );
  check("coverage adds up", coverageAddsUp(coverage));
}

console.log("\n— malformed amounts —");
{
  const { usd, coverage } = value([
    row(USDC, "1000000"),
    row(USDC, "1.5"), // decimal string: BigInt would throw, Number would lie
    row(USDC, "1e6"), // exponent notation
    row(USDC, "-1000000"), // negative
    row(USDC, ""), // empty
    row(USDC, null), // null
  ]);
  check("only the integer row counted", near(usd, 1), `got ${usd}`);
  check(
    "five rows flagged malformed",
    coverage.malformedAmount === 5,
    JSON.stringify(coverage),
  );
  check("coverage adds up", coverageAddsUp(coverage));
}

console.log("\n— zero is a measurement, null is not —");
{
  // An empty book genuinely is $0 and must say so.
  const empty = value([]);
  check("empty book → 0, not null", empty.usd === 0, `got ${empty.usd}`);

  // Rows present but the feed answered with nothing → null, never 0. This is
  // the case the old hook rendered as a confident "$0".
  const dead = value(
    [row(USDC, "1000000"), row(ETH, "1000000000000000000")],
    () => null,
  );
  check("dead feed → null", dead.usd === null, `got ${dead.usd}`);
  check(
    "both rows reported unpriced",
    dead.coverage.unpriced === 2,
    JSON.stringify(dead.coverage),
  );

  // A book of nothing but unrecognised tokens is not a failed measurement:
  // there was nothing priceable to measure, so 0 is the honest answer and
  // coverage says every row was excluded.
  const unknownOnly = value([row("0xdead", "1000000")]);
  check(
    "unknown-token-only book → 0 with full disclosure",
    unknownOnly.usd === 0 && unknownOnly.coverage.unknownToken === 1,
    JSON.stringify(unknownOnly),
  );

  // Partial coverage returns the partial total, not null — but says so.
  const partial = value(
    [row(USDC, "2000000"), row(ETH, "1000000000000000000")],
    (s) => (s === "USDC" ? 1 : null),
  );
  check(
    "partial → $2 with 1 unpriced",
    near(partial.usd, 2) && partial.coverage.unpriced === 1,
    JSON.stringify(partial),
  );
}

console.log("\n— toWholeUnits —");
{
  check(
    "0 wei → 0.000…",
    toWholeUnits(BigInt(0), 18) === `0.${"0".repeat(18)}`,
  );
  check(
    "1 wei keeps every digit",
    toWholeUnits(BigInt(1), 18) === "0.000000000000000001",
  );
  check("6dp", toWholeUnits(BigInt("1234567"), 6) === "1.234567");
  check("no decimals", toWholeUnits(BigInt("1234567"), 0) === "1234567");
  check(
    "sub-unit is not truncated to zero",
    parseFloat(toWholeUnits(BigInt("500000"), 6)) === 0.5,
  );
}

console.log("\n— the fabricated revenue figure —");
{
  // The old strip showed "Revenue" as volume × 0.003 — Uniswap's swap fee on
  // lending volume. Nothing here produces such a number; this asserts the
  // module exposes no revenue concept at all, so it cannot creep back.
  const folded = foldBook([row(USDC, "1000000")], CURRENCIES);
  const keys = Object.keys(valueBook(folded, priceOf));
  check(
    "valueBook returns only usd + coverage",
    keys.length === 2 && keys.includes("usd") && keys.includes("coverage"),
    keys.join(","),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
