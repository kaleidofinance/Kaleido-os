/*
 * `npx tsx "src/app/(app)/trade/agent/suggestions.test.ts"`
 *
 * Suggestions are executable text. These checks make sure the empty card stays
 * grounded in live wallet/activity signals and never regresses to the old
 * testnet action catalogue.
 */
import { computeSuggestions } from "./suggestions.ts";
import { parseCommand } from "../../../../lib/v2/intents/fromCommand.ts";

let pass = 0;
let fail = 0;
const check = (name: string, condition: boolean, detail = "") => {
  if (condition) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const TOKENS = [
  { address: "0xusdc", name: "USD Coin", symbol: "USDC", decimals: 6, chainId: 11124 },
  { address: "0xeurc", name: "Euro Coin", symbol: "EURC", decimals: 6, chainId: 11124 },
];
const parse = (text: string) => parseCommand(text, TOKENS);

const assertParses = (label: string, prompts: string[]) => {
  for (const prompt of prompts) {
    check(`${label}: ${prompt}`, parse(prompt).status === "ok", String(parse(prompt).status));
  }
};

console.log("\n— a fresh wallet gets only universal reads —");
{
  const fresh = computeSuggestions({ limit: 10 });
  check("fresh row is conservative", fresh.join(" | ") === "my portfolio | show my address", fresh.join(" | "));
  assertParses("fresh chips parse", fresh);
  check("fresh row contains no testnet action", !fresh.some((p) => /faucet|stake|mint|lend|borrow/i.test(p)));
}

console.log("\n— live wallet balances become useful follow-ups —");
{
  const balances = computeSuggestions({ walletSymbols: ["USDC", "EURC"], limit: 10 });
  check("wallet symbols are reflected", balances.includes("how much USDC do I have"), balances.join(" | "));
  check("second wallet symbol is reflected", balances.includes("how much EURC do I have"), balances.join(" | "));
  check("universal reads remain available", balances.includes("my portfolio") && balances.includes("show my address"));
  assertParses("balance chips parse", balances);
}

console.log("\n— transaction activity grounds the same row —");
{
  const afterSwap = computeSuggestions({
    recentEntries: [{ kind: "swap", title: "Swap 100 USDC for EURC", status: "confirmed" }],
    walletSymbols: ["USDC"],
    limit: 10,
  });
  check("activity keeps the user's live asset visible", afterSwap[0] === "how much USDC do I have", afterSwap.join(" | "));
  check("activity does not invent a next trade", !afterSwap.some((p) => /swap|bridge|faucet|stake|mint|lend|borrow/i.test(p)));
  assertParses("activity chips parse", afterSwap);

  const reverted = computeSuggestions({
    recentEntries: [{ kind: "swap", status: "reverted" }],
    walletSymbols: [],
    limit: 10,
  });
  check("reverted activity does not unlock product suggestions", reverted.join(" | ") === "my portfolio | show my address", reverted.join(" | "));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
