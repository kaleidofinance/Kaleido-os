// Checks on history-derived suggestion chips. Run with plain node — no test
// runner in this repo, same as fromCommand.test.ts.
//
// The property under test, and the reason this file exists at all: a chip is
// executable. Its text goes to parseCommand on click, so a chip that reads well
// and parses to "unknown" is a button that costs a model credit to fail. Every
// suggestion this module can emit is asserted to parse.
import { nextSuggestions } from "./nextSuggestions.ts";
import { parseCommand } from "./fromCommand.ts";

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const TOKENS = [
  {
    address: "0xkld",
    name: "Kaleido",
    symbol: "KLD",
    decimals: 18,
    chainId: 11124,
  },
  {
    address: "0xusdc",
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    chainId: 11124,
    tags: ["stablecoin"],
  },
  {
    address: "0xkfusd",
    name: "Kaleido USD",
    symbol: "kfUSD",
    decimals: 18,
    chainId: 11124,
    tags: ["stablecoin"],
  },
];

const FALLBACK = [
  "swap 500 USDC to KLD",
  "stake 100 KLD",
  "mint 500 USDC",
  "lend 1,000 USDC at 10% for 60 days",
  "borrow 500 USDC at 8% for 30 days",
  "receive",
];

const u = (text) => ({ role: "user", text });
const a = (text) => ({ role: "assistant", text });
const n = (history, fb = FALLBACK) => nextSuggestions(history, TOKENS, fb);

console.log("\n— every emitted chip parses —");
{
  /* The whole point. Drive it through a spread of histories that between them
     reach every branch of SEQUELS, and assert on the union of what comes out. */
  const histories = [
    [],
    [u("swap 500 USDC to KLD")],
    [u("swap 500 KLD to USDC")],
    [u("stake 100 KLD")],
    [u("borrow 500 USDC at 8% for 30 days")],
    [u("deposit 500 USDC")],
    [u("mint 500 USDC")],
    [u("lock 100 kfUSD")],
    [u("claim")],
    [u("receive")],
    [u("help")],
    [u("explain my health factor")],
    [u("what is my cheapest borrow")],
  ];
  const bad = [];
  for (const h of histories)
    for (const chip of n(h))
      if (parseCommand(chip, TOKENS).status !== "ok") bad.push(chip);
  check("no chip is unparseable", bad.length === 0, bad.join(" | "));
}

console.log("\n— sequels lead —");
{
  const r = n([u("swap 500 USDC to KLD")]);
  check(
    "swap into KLD suggests staking it",
    r[0] === "stake 100 KLD",
    r.join(" | "),
  );

  const s = n([u("stake 100 KLD")]);
  check(
    "staking suggests both accrual verbs",
    s[0] === "claim" && s[1] === "compound",
    s.join(" | "),
  );

  const b = n([u("borrow 500 USDC at 8% for 30 days")]);
  check("borrowing suggests repaying", b[0] === "repay", b.join(" | "));

  const d = n([u("deposit 500 USDC")]);
  check(
    "collateral suggests borrowing that token",
    d[0] === "borrow 500 USDC at 8% for 30 days",
    d.join(" | "),
  );

  const m = n([u("mint 500 USDC")]);
  check(
    "minting suggests locking, then redeeming the collateral",
    m[0] === "lock 100 kfUSD" && m[1] === "redeem 100 USDC",
    m.join(" | "),
  );
}

console.log("\n— a swap out of KLD offers no sequel —");
{
  /* The guess is only good in one direction, and the negative case is the one
     that keeps the table honest: no chip should claim to know what follows. */
  const r = n([u("swap 500 KLD to USDC")], []);
  check("no sequel invented", r.length === 0, r.join(" | "));
}

console.log("\n— history repeats, newest first —");
{
  const r = n(
    [
      u("swap 500 USDC to KLD"),
      a("Here is the plan."),
      u("lend 1,000 USDC at 10% for 60 days"),
      a("Listed."),
      u("stake 100 KLD"),
    ],
    [],
  );
  /* stake's sequels lead; then the user's own turns, newest first, minus the
     one just issued. */
  check(
    "own phrasing follows the sequels, newest first",
    r[0] === "claim" &&
      r[1] === "compound" &&
      r[2] === "lend 1,000 USDC at 10% for 60 days",
    r.join(" | "),
  );
}

console.log("\n— the latest command is not offered back —");
{
  const r = n([u("lend 1,000 USDC at 10% for 60 days")], []);
  check(
    "no chip repeats what was just asked",
    !r.some((c) => c.toLowerCase() === "lend 1,000 usdc at 10% for 60 days"),
    r.join(" | "),
  );
}

console.log("\n— help and receive are answered once —");
{
  const r = n([u("help"), a("Here's what I can do."), u("receive")], []);
  check("neither is re-offered", r.length === 0, r.join(" | "));
}

console.log("\n— Luca's prose is never mined —");
{
  /* An assistant turn full of verbs and symbols. Parsing it would surface
     commands the user never asked for, attributed to them. */
  const r = n(
    [a("You would receive 4,812 KLD. I could stake 100 KLD for you next.")],
    [],
  );
  check("assistant turns contribute nothing", r.length === 0, r.join(" | "));
}

console.log("\n— questions fall through to the fallback —");
{
  const r = n([u("explain my health factor"), a("It is 1.8.")]);
  check(
    "a thread of questions still shows the product list",
    r.length === 3 && r[0] === FALLBACK[0],
    r.join(" | "),
  );
}

console.log("\n— empty history is the fallback —");
{
  const r = n([]);
  check("first three of the product list", r.length === 3, r.join(" | "));
}

console.log("\n— deduped and capped —");
{
  const r = n([
    u("swap 500 USDC to KLD"),
    u("SWAP 500 USDC TO KLD"),
    u("stake 100 KLD"),
  ]);
  const lower = r.map((c) => c.toLowerCase());
  check(
    "no duplicate ignoring case",
    new Set(lower).size === lower.length,
    r.join(" | "),
  );
  check("never more than three", r.length <= 3, String(r.length));
}

console.log("\n— blank turns are ignored —");
{
  const r = n([u("   "), u("")], []);
  check(
    "whitespace-only history yields nothing",
    r.length === 0,
    r.join(" | "),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
