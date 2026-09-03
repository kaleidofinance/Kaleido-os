// What a given set of positions turns into, as prose and cards.
//
// Run with plain node like the rest. The point of testing this rather than the
// page is that a portfolio has states that are tedious to reach with a real
// wallet and easy to get wrong: an address holding only KLD (real amounts, no
// price feed, so no total), a loan open (health becomes a number worth showing),
// nothing at all (which is the state every invited tester starts in).
//
// Everything is asserted through `localCards` as well as directly, because that
// validator is what the frames actually receive — a title one character too long
// or a ninth row is dropped there, silently, and a card that vanishes between
// here and the screen is the failure this file exists to catch.
import { portfolioAnswer } from "./portfolio.ts";
import { localCards } from "./fromChat.ts";

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

const row = (label, amount, valueUsd) => ({
  id: `w-${label}`,
  kind: "wallet",
  label,
  sublabel: "Wallet",
  amount,
  valueUsd,
  apy: null,
  state: { tone: "ok", text: "Idle" },
});

const group = (id, title, subtotalUsd, rows = [], unpriced = []) => ({
  id,
  title,
  subtotalUsd,
  unpriced,
  rows,
  empty: "",
  href: "/",
});

/** The five groups in the hook's order, empty unless overridden. */
const groups = (over = {}) =>
  [
    ["wallet", "Wallet"],
    ["lending", "Lending"],
    ["borrowing", "Borrowing"],
    ["stable", "Stable"],
    ["staking", "Staking & LP"],
  ].map(([id, title]) => over[id] ?? group(id, title, 0));

const portfolio = (over = {}) => ({
  netValue: 0,
  netValuePartial: false,
  collateralUsd: null,
  debtUsd: null,
  health: null,
  unclaimedYieldUsd: null,
  groups: groups(over.groupsBy ?? {}),
  alerts: [],
  isLoading: false,
  ...over,
});

const kinds = (a) => a.cards.map((c) => c.kind).join(",");
const card = (a, kind) => a.cards.find((c) => c.kind === kind);

console.log("\n— no wallet connected —");
{
  const a = portfolioAnswer(portfolio(), { connected: false });
  check("no cards", a.cards.length === 0, kinds(a));
  check("says to connect one", /connect a wallet/i.test(a.text));
  check(
    "does not report a balance it cannot have read",
    !a.text.includes("$"),
    a.text,
  );
}

console.log("\n— connected, holding nothing —");
{
  const a = portfolioAnswer(portfolio(), { connected: true });
  check("one card, and it is actionable", kinds(a) === "actions", kinds(a));
  check(
    "offers the faucet by the phrasing the grammar parses",
    card(a, "actions").actions[0].prompt === "claim everything from the faucet",
  );
  check("explains that gas comes first", /public faucet/i.test(a.text));
  check(
    "no table of zeros",
    !a.cards.some((c) => c.kind === "stats" || c.kind === "balance"),
    kinds(a),
  );
  check("survives the validator", localCards(a.cards).length === 1);
}

console.log("\n— a funded wallet, no debt —");
{
  const a = portfolioAnswer(
    portfolio({
      netValue: 1234.5,
      groupsBy: {
        wallet: group("wallet", "Wallet", 1234.5, [
          row("USDC", "1,000", 1000),
          row("ETH", "0.0812", 234.5),
          row("KLD", "5,000", null),
        ]),
      },
    }),
    { connected: true },
  );
  check(
    "figure, breakdown, balances",
    kinds(a) === "metric,stats,balance",
    kinds(a),
  );
  check(
    "the net value is the headline",
    card(a, "metric").value === "$1,234.50",
  );
  check("prose leads with it", a.text.startsWith("$1,234.50 net"), a.text);
  check(
    "five groups and no health row",
    card(a, "stats").rows.length === 5 &&
      !card(a, "stats").rows.some((r) => r.label === "Health factor"),
    JSON.stringify(card(a, "stats").rows),
  );
  check(
    "balances carry the token amount, not the dollars",
    card(a, "balance").rows[0].symbol === "USDC" &&
      card(a, "balance").rows[0].amount === "1,000",
  );
  check("largest first", card(a, "balance").rows[1].symbol === "ETH");
  check(
    "an unpriced holding says so rather than showing an em dash alone",
    card(a, "balance").rows[2].note === "no price feed",
    card(a, "balance").rows[2].note,
  );
  check(
    "all three survive the validator",
    localCards(a.cards).length === 3,
    JSON.stringify(localCards(a.cards).map((c) => c.kind)),
  );
}

console.log("\n— a loan open —");
{
  const a = portfolioAnswer(
    portfolio({
      netValue: 800,
      collateralUsd: 1500,
      debtUsd: 700,
      health: 1.12,
      groupsBy: {
        wallet: group("wallet", "Wallet", 0),
        borrowing: group("borrowing", "Borrowing", -700, [
          row("USDC", "700", -700),
        ]),
      },
    }),
    { connected: true },
  );
  const health = card(a, "stats").rows.find((r) => r.label === "Health factor");
  check("health joins the breakdown", !!health, kinds(a));
  check("as the number, not a band", health?.value === "1.12");
  check("tinted by the same bands as the FAQ card", health?.tone === "warn");
  check(
    "prose names the debt and the collateral behind it",
    a.text.includes("$700.00 borrowed against $1,500.00"),
    a.text,
  );
}

console.log("\n— no debt means no health row —");
{
  const a = portfolioAnswer(
    portfolio({
      netValue: 10,
      debtUsd: 0,
      health: Infinity,
      groupsBy: {
        wallet: group("wallet", "Wallet", 10, [row("USDC", "10", 10)]),
      },
    }),
    { connected: true },
  );
  check(
    "an infinite health factor answers nothing, so it is absent",
    !card(a, "stats").rows.some((r) => r.label === "Health factor"),
  );
}

console.log("\n— holdings with no price feed at all —");
{
  const a = portfolioAnswer(
    portfolio({
      netValue: null,
      netValuePartial: true,
      groupsBy: {
        wallet: group(
          "wallet",
          "Wallet",
          null,
          [row("KLD", "5,000", null)],
          ["KLD"],
        ),
      },
    }),
    { connected: true },
  );
  check("never writes a null total as zero", !a.text.includes("$0"), a.text);
  check("says there is no total", /no total/i.test(a.text), a.text);
  check("the figure is an em dash", card(a, "metric").value === "—");
  check(
    "the note names what could not be summed",
    card(a, "metric").note?.includes("KLD"),
    card(a, "metric").note,
  );
  check(
    "the amount is still exact",
    card(a, "balance").rows[0].amount === "5,000",
  );
}

console.log("\n— a partial total is labelled as a floor —");
{
  const a = portfolioAnswer(
    portfolio({
      netValue: 1000,
      netValuePartial: true,
      groupsBy: {
        wallet: group(
          "wallet",
          "Wallet",
          1000,
          [row("USDC", "1,000", 1000), row("KLD", "5,000", null)],
          ["KLD", "WBTC", "stKLD", "USDR"],
        ),
      },
    }),
    { connected: true },
  );
  const note = card(a, "metric").note ?? "";
  check("the note says it is a floor", /floor/i.test(note), note);
  check("it names some and counts the rest", note.includes("and 1 more"), note);
  check(
    "and it fits the validator's cap",
    localCards(a.cards)[0].note === note,
  );
}

console.log("\n— unclaimed yield is offered, not just reported —");
{
  const a = portfolioAnswer(
    portfolio({
      netValue: 50,
      unclaimedYieldUsd: 12.34,
      groupsBy: {
        wallet: group("wallet", "Wallet", 50, [row("USDC", "50", 50)]),
      },
    }),
    { connected: true },
  );
  check("names the figure", a.text.includes("$12.34"), a.text);
  check(
    "and the phrasing that claims it",
    a.text.includes('"claim yield"'),
    a.text,
  );
}

console.log("\n— more holdings than one card can show —");
{
  const many = Array.from({ length: 11 }, (_, i) =>
    row(`T${i}`, String(11 - i), 11 - i),
  );
  const a = portfolioAnswer(
    portfolio({
      netValue: 66,
      groupsBy: { wallet: group("wallet", "Wallet", 66, many) },
    }),
    { connected: true },
  );
  const balance = card(a, "balance");
  check("shows the card's maximum", balance.rows.length === 8);
  check(
    "and says what it left out, because the validator would not",
    balance.title === "Wallet — largest 8 of 11",
    balance.title,
  );
  check(
    "the eight are the largest eight",
    balance.rows[0].symbol === "T0" && balance.rows[7].symbol === "T7",
    balance.rows.map((r) => r.symbol).join(","),
  );
  check(
    "nothing is dropped on the way to the frame",
    localCards(a.cards).find((c) => c.kind === "balance").rows.length === 8,
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
