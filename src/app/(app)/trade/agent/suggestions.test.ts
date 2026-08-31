/*
 * Checks on the agent card's starting-point chips. Run with
 * `npx tsx "src/app/(app)/trade/agent/suggestions.test.ts"` — tsx rather than
 * plain node for the path, not the code: the directory has parentheses in it.
 *
 * WHY THIS SUITE EXISTS. A chip is executable. Its text goes to parseCommand on
 * click, so one that reads well and parses to "unknown" is a button that costs a
 * model credit to fail — and it fails silently, because nothing about the chip
 * looks wrong. Types cannot catch it: the chips are strings and so is the
 * grammar. This file is the only thing standing between a reworded chip and a
 * dead button.
 *
 * It replaces the equivalent guard inside nextSuggestions.test.ts, which went
 * with that module: the composer's predicted-chip row is gone, so the empty
 * card's list is now the only chip surface left to protect.
 *
 * What is asserted, in order of how badly it fails when wrong:
 *
 *   1. Every chip parses. The whole point.
 *   2. Each one parses to the *intended* command. Three of them sit next to a
 *      trap the parser resolves in a specific order, and "it parsed" would pass
 *      while planning the wrong product entirely — see the cases below.
 *   3. None is a bare verb. A row reading "claim / compound / receive" is the
 *      keyword list leaking into the UI, shown to someone who does not know
 *      there is a keyword list.
 */
import { SUGGESTIONS } from "./suggestions.ts";
import { parseCommand } from "../../../../lib/v2/intents/fromCommand.ts";

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

/* The three symbols the chips name, shaped like the registry the page passes in
   from `chainTokens(chainId)`. kfUSD is here despite no chip naming it, because
   the mint case below is asserting that it is *not* picked up. */
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

const parse = (text) => parseCommand(text, TOKENS);
const kindOf = (text) => {
  const r = parse(text);
  return r.status === "ok" ? r.command.kind : `${r.status}`;
};

console.log("\n— every chip parses —");
{
  const bad = SUGGESTIONS.filter((s) => parse(s).status !== "ok");
  check("no chip is unparseable", bad.length === 0, bad.join(" | "));
}

console.log("\n— each chip reaches the surface it advertises —");
{
  /* One per product, and the list is asserted whole rather than per item: a chip
     deleted in a reword would otherwise pass every remaining check. */
  const EXPECTED = [
    ["claim everything from the faucet", "claimTestTokens"],
    ["swap 500 USDC to KLD", "swap"],
    ["stake 100 KLD", "stake"],
    ["mint 500 USDC", "mint"],
    ["lend 1,000 USDC at 10% for 60 days", "lend"],
    ["borrow 500 USDC at 8% for 30 days", "borrow"],
    ["show my address", "receive"],
  ];
  check(
    "the list is exactly the seven surfaces, in order",
    SUGGESTIONS.length === EXPECTED.length &&
      SUGGESTIONS.every((s, i) => s === EXPECTED[i][0]),
    SUGGESTIONS.join(" | "),
  );
  for (const [text, kind] of EXPECTED) {
    check(`"${text}" → ${kind}`, kindOf(text) === kind, kindOf(text));
  }
}

console.log("\n— the three chips that sit next to a trap —");
{
  /* The faucet chip contains the word "claim", and ZERO_SLOT_VERBS scans the
     whole sentence. It resolves correctly only because VERBS.claimTestTokens is
     checked first; reverse that order and this chip plans a kfUSD yield claim
     from a sentence that says "faucet". */
  const faucet = parse("claim everything from the faucet");
  check(
    "the faucet chip is not hijacked by claimYield",
    faucet.status === "ok" && faucet.command.kind === "claimTestTokens",
    kindOf("claim everything from the faucet"),
  );
  check(
    "and it asks for every asset due, not one",
    faucet.status === "ok" &&
      faucet.command.kind === "claimTestTokens" &&
      faucet.command.symbol === "everything",
    JSON.stringify(faucet),
  );

  /* Mint binds its token as the *collateral*, so the chip has to name the
     collateral. "mint 500 kfUSD" would parse and then be refused by the planner
     with "kfUSD isn't accepted as kfUSD collateral" — a chip that fails one
     screen later, which is worse than one that fails on click. */
  const mint = parse("mint 500 USDC");
  check(
    "the mint chip names the collateral, not the output",
    mint.status === "ok" &&
      mint.command.kind === "mint" &&
      mint.command.token.symbol === "USDC",
    JSON.stringify(mint),
  );

  /* RECEIVE_PHRASES is matched as a leading phrase, on purpose — "receive" is
     ordinary trading English. So this chip is the one whose wording is not free:
     it has to be a phrase on that list. */
  check(
    "the receive chip is a phrase the parser leads with",
    kindOf("show my address") === "receive",
    kindOf("show my address"),
  );
  check(
    "a near miss would not have parsed",
    kindOf("show my wallet address") === "unknown",
    kindOf("show my wallet address"),
  );
}

console.log("\n— none is a bare verb —");
{
  /* The complaint that produced this rule: chips reading "claim", "compound",
     "receive" describe the grammar rather than the action. Three words is the
     floor at which a chip states an amount or an object. */
  const terse = SUGGESTIONS.filter((s) => s.trim().split(/\s+/).length < 3);
  check("every chip is a whole request", terse.length === 0, terse.join(" | "));
}

console.log("\n— no duplicates —");
{
  const lower = SUGGESTIONS.map((s) => s.toLowerCase());
  check(
    "no chip repeats another",
    new Set(lower).size === lower.length,
    SUGGESTIONS.join(" | "),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
