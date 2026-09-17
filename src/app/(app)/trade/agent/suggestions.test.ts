/*
 * Checks on the agent card's starting-point chips. Run with
 * `npx tsx "src/app/(app)/trade/agent/suggestions.test.ts"` — tsx rather than
 * plain node for the path, not the code: the directory has parentheses in it.
 *
 * WHY THIS SUITE EXISTS. A chip is executable. Its text goes to parseCommand on
 * click, so one that reads well and parses to "unknown" is a button that costs a
 * model credit to fail — and it fails silently, because nothing about the chip
 * looks wrong. Types cannot catch it: the chips are strings and so is the grammar.
 *
 * `computeSuggestions` added two behaviours this now also protects:
 *   - mode gating: the testnet-only surfaces (faucet, KLD, staking, kfUSD,
 *     lending) must NOT appear on mainnet, where they aren't deployed;
 *   - activity ranking: what the wallet last did reorders the list.
 * Both are asserted below, alongside the original "every chip parses to the
 * command it advertises".
 */
import { computeSuggestions } from "./suggestions.ts";
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

/* The tokens the chips name, shaped like the registry the page passes in from
   `chainTokens(chainId)`. EURC and WUSDC are here for the mainnet chips (a swap to
   EURC, and the wrap expressed as a swap to WUSDC); kfUSD is here so the mint case
   can assert it is NOT picked up as the output. */
const TOKENS = [
  { address: "0xkld", name: "Kaleido", symbol: "KLD", decimals: 18, chainId: 11124 },
  { address: "0xusdc", name: "USD Coin", symbol: "USDC", decimals: 6, chainId: 11124, tags: ["stablecoin"] },
  { address: "0xeurc", name: "Euro Coin", symbol: "EURC", decimals: 6, chainId: 11124, tags: ["stablecoin"] },
  { address: "0xwusdc", name: "Wrapped USDC", symbol: "WUSDC", decimals: 18, chainId: 11124, tags: ["wrapped-native"] },
  { address: "0xkfusd", name: "Kaleido USD", symbol: "kfUSD", decimals: 18, chainId: 11124, tags: ["stablecoin"] },
];

const parse = (text) => parseCommand(text, TOKENS);
const kindOf = (text) => {
  const r = parse(text);
  return r.status === "ok" ? r.command.kind : `${r.status}`;
};

const mainnet = computeSuggestions({ showTestnets: false, limit: 20 });
const testnet = computeSuggestions({ showTestnets: true, limit: 20 });

console.log("\n— every chip parses, in both modes —");
{
  const all = [...new Set([...mainnet, ...testnet])];
  const bad = all.filter((s) => parse(s).status !== "ok");
  check("no chip is unparseable", bad.length === 0, bad.join(" | "));
  /* And none is a bare verb — a row of keywords shown to someone who does not know
     there is a keyword list. Three words is the floor at which a chip states an
     amount or an object. */
  const terse = all.filter((s) => s.trim().split(/\s+/).length < 3);
  check("every chip is a whole request", terse.length === 0, terse.join(" | "));
  const lower = all.map((s) => s.toLowerCase());
  check("no chip repeats another within a mode",
    new Set(mainnet).size === mainnet.length && new Set(testnet).size === testnet.length,
    all.join(" | "));
}

console.log("\n— mainnet drops every testnet-only surface —");
{
  /* The whole point of the gate: a mainnet wallet must never be handed the faucet,
     a KLD trade or stake, the kfUSD mint, or lending — none of which is on Arc. */
  const forbidden = [/faucet/i, /KLD/, /\bmint\b/i, /\blend\b/i, /\bborrow\b/i, /\bstake\b/i];
  const leaks = mainnet.filter((s) => forbidden.some((re) => re.test(s)));
  check("no testnet-only chip on mainnet", leaks.length === 0, leaks.join(" | "));
  /* What SURVIVES is what Arc does: a swap, a bridge, the wrap, and a read. */
  check("mainnet still offers real starting points", mainnet.length >= 3, mainnet.join(" | "));
  check("mainnet keeps the address read", mainnet.includes("show my address"));
  check("mainnet keeps a swap", mainnet.some((s) => kindOf(s) === "swap"), mainnet.join(" | "));
  check("mainnet keeps the bridge", mainnet.some((s) => kindOf(s) === "bridge"), mainnet.join(" | "));
}

console.log("\n— testnet keeps the full set, each reaching its surface —");
{
  const EXPECTED = [
    ["claim everything from the faucet", "claimTestTokens"],
    ["swap 500 USDC to KLD", "swap"],
    ["stake 100 KLD", "stake"],
    ["mint 500 USDC", "mint"],
    ["lend 1,000 USDC at 10% for 60 days", "lend"],
    ["borrow 500 USDC at 8% for 30 days", "borrow"],
    ["show my address", "receive"],
  ];
  for (const [text, kind] of EXPECTED) {
    check(`testnet offers "${text}"`, testnet.includes(text), testnet.join(" | "));
    check(`"${text}" → ${kind}`, kindOf(text) === kind, kindOf(text));
  }
}

console.log("\n— the three chips that sit next to a trap (testnet) —");
{
  /* The faucet chip contains "claim", and ZERO_SLOT_VERBS scans the whole
     sentence; it resolves correctly only because VERBS.claimTestTokens is checked
     first. */
  const faucet = parse("claim everything from the faucet");
  check("faucet is not hijacked by claimYield",
    faucet.status === "ok" && faucet.command.kind === "claimTestTokens" && faucet.command.symbol === "everything",
    JSON.stringify(faucet));
  /* Mint binds its token as the COLLATERAL, so the chip names the collateral. */
  const mint = parse("mint 500 USDC");
  check("mint names the collateral, not the output",
    mint.status === "ok" && mint.command.kind === "mint" && mint.command.token.symbol === "USDC",
    JSON.stringify(mint));
  /* RECEIVE_PHRASES is matched as a leading phrase — a near miss falls through. */
  check("receive is a phrase the parser leads with", kindOf("show my address") === "receive");
  check("a near miss would not have parsed", kindOf("show my wallet address") === "unknown");
}

console.log("\n— activity ranking: what you did last reorders the list —");
{
  /* Just swapped → bridge (which follows a swap) is promoted above a fresh wallet's
     order, and the swap chip is not offered straight back at the top. */
  const afterSwap = computeSuggestions({ showTestnets: false, recentKinds: ["swap"] });
  check("after a swap, bridge is promoted to the top",
    afterSwap[0] === "bridge 100 USDC to Base", afterSwap.join(" | "));
  /* Just bridged → a swap (which follows a bridge) leads instead. */
  const afterBridge = computeSuggestions({ showTestnets: false, recentKinds: ["bridge"] });
  check("after a bridge, a swap leads",
    kindOf(afterBridge[0]) === "swap", afterBridge.join(" | "));
  /* A fresh wallet gets the default order — the first mainnet-valid entry. */
  const fresh = computeSuggestions({ showTestnets: false });
  check("a fresh wallet gets the default order", fresh[0] === "swap 100 USDC to EURC", fresh.join(" | "));
  /* On testnet, just claimed from the faucet → the KLD swap that follows a claim
     is promoted. */
  const afterClaim = computeSuggestions({ showTestnets: true, recentKinds: ["claimTestTokens"] });
  check("after a faucet claim, the next step is promoted",
    afterClaim[0] === "swap 500 USDC to KLD", afterClaim.join(" | "));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
