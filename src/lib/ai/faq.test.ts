// Checks on FAQ matching. Run with plain node — no test runner in this repo,
// and no runtime imports in faq.ts, same as fromCommand.test.ts.
//
// The bias under test: a genuine miss must fall through silently (null), never
// guess a nearby topic. A wrong FAQ answer is worse than no answer, because it
// reads as confident and correct.
import { matchFaq, FAQ_TOPICS, isQuestionShaped } from "./faq.ts";
// The grammar, because reachability is a property of the pair, not of this file:
// a trigger the parser claims first can never fire, however well it is written.
import { parseCommand } from "../v2/intents/fromCommand.ts";

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

console.log("\n— matches real phrasing —");
check(
  "health factor",
  matchFaq("what's my health factor")?.id === "health-factor",
);
check(
  "liquidation, no exact phrase",
  matchFaq("can I get liquidated here")?.id === "health-factor",
);
check(
  "points, casual phrasing",
  matchFaq("hows the points system work")?.id === "points",
);
check("kfusd", matchFaq("what is kfUSD")?.id === "kfusd");
check("kafusd, case insensitive", matchFaq("WHAT IS KAFUSD")?.id === "kafusd");
check("staking", matchFaq("how does staking work exactly")?.id === "staking");
check(
  "agent permission",
  matchFaq("what can luca do for me")?.id === "agent-permission",
);
check("slippage", matchFaq("what is slippage tolerance")?.id === "slippage");
check("chains", matchFaq("which chains do you support")?.id === "chains");
check(
  "model credits",
  matchFaq("how many reasoning requests do I get")?.id === "model-credits",
);
check("audit status", matchFaq("is this audited")?.id === "audit-status");

console.log("\n— genuine misses fall through silently —");
check(
  "unrelated question returns null",
  matchFaq("what's the weather like") === null,
);
check(
  "a stated command is not a question",
  matchFaq("swap 500 usdc to kld") === null,
);
check("empty string", matchFaq("") === null);
check(
  "close-but-not-quite still misses",
  matchFaq("what is a factor of ten") === null,
);

console.log("\n— overlap resolves to the more specific topic —");
{
  // "vault" alone isn't a trigger for anything; the full phrase should still
  // land on kafusd specifically, not some shorter unrelated match.
  const r = matchFaq("how does the vault work");
  check("longest/most specific trigger wins", r?.id === "kafusd", r?.id);
}

console.log("\n— every topic is reachable and non-degenerate —");
{
  let allReachable = true;
  let noEmptyTriggers = true;
  for (const topic of FAQ_TOPICS) {
    if (topic.triggers.length === 0) noEmptyTriggers = false;
    for (const trigger of topic.triggers) {
      if (matchFaq(trigger)?.id !== topic.id) {
        allReachable = false;
        console.log(
          `  FAIL trigger "${trigger}" does not resolve to topic "${topic.id}"`,
        );
      }
    }
  }
  check(
    "every trigger phrase actually resolves to its own topic",
    allReachable,
  );
  check("no topic has an empty trigger list", noEmptyTriggers);
}

console.log("\n— the questions a first-time tester actually asks —");
check("test tokens", matchFaq("how do I get test tokens")?.id === "test-funds");
check("gas", matchFaq("I have no ETH for gas")?.id === "test-funds");
check("empty balance", matchFaq("why is my balance 0")?.id === "test-funds");
check(
  "faucet frequency",
  matchFaq("how often can I claim")?.id === "test-funds",
);
check("identity", matchFaq("who are you")?.id === "orientation");
check("is it a bot", matchFaq("are you an AI")?.id === "orientation");
check("the product", matchFaq("what is this app")?.id === "orientation");
check(
  "where to begin",
  matchFaq("what should I do first")?.id === "orientation",
);
check(
  "wallet support",
  matchFaq("which wallet do you support")?.id === "wallet",
);
check("no wallet at all", matchFaq("I dont have a wallet")?.id === "wallet");
check(
  "phishing, asked as a question",
  matchFaq("do you need my seed phrase")?.id === "wallet",
);
check("real money", matchFaq("is this real money")?.id === "mainnet");
check("mainnet date", matchFaq("when is mainnet")?.id === "mainnet");
check("the token", matchFaq("what is KLD")?.id === "kld");
check("getting the token", matchFaq("how do I get KLD")?.id === "kld");
check("docs", matchFaq("where are the docs")?.id === "docs-support");
check("bugs", matchFaq("I found a bug")?.id === "docs-support");
check(
  "quota, described as a symptom",
  matchFaq("why did you stop answering me")?.id === "model-credits",
);
check("earning points", matchFaq("how do I earn points")?.id === "points");
{
  // KLD-the-token and KLD-staking are different questions and the second one
  // existed first, so the new topic must not have stolen it.
  const r = matchFaq("how does staking work");
  check("staking still wins its own question", r?.id === "staking", r?.id);
}

/*
 * The funding question is asked as a request at least as often as it is asked as
 * a question — "my wallet is empty", "I need test ETH" — and those phrasings miss
 * the grammar (it has one faucet word) as well as the FAQ, so they used to land on
 * the model to be told about a faucet page.
 */
console.log("\n— funding, phrased as a complaint rather than a question —");
check("empty wallet", matchFaq("my wallet is empty")?.id === "test-funds");
check(
  "the shorter form too",
  matchFaq("empty wallet here, what now")?.id === "test-funds",
);
check("need test ETH", matchFaq("i need test eth")?.id === "test-funds");
check("need gas", matchFaq("need some gas please")?.id === "test-funds");
check(
  "how do I fund",
  matchFaq("how do i fund my wallet")?.id === "test-funds",
);
check("adding funds", matchFaq("how do i add funds")?.id === "test-funds");
check("give me some", matchFaq("give me usdc")?.id === "test-funds");
/* Both of these used to be claimed by the grammar and answered wrongly: "fund" is
   fillRequest's verb. The grammar now declines them, and this is the answer they
   fall through to — so a regression there shows up here as well as in the
   shadowing check below. */
check("fund my wallet", matchFaq("fund my wallet")?.id === "test-funds");
check("fund me", matchFaq("fund me")?.id === "test-funds");
check(
  "and the answer offers the phrasing that acts on it",
  matchFaq("my wallet is empty")?.cards?.some((c) =>
    c.actions?.some((a) => a.prompt === "claim everything from the faucet"),
  ),
);
{
  /* "need eth" is deliberately not a trigger: at 8 characters it ties with
     mainnet's "real eth", and matchFaq breaks ties by topic order, so this topic
     would steal "do I need real ETH for this". Asserted rather than trusted. */
  const r = matchFaq("do i need real eth for this");
  check(
    "a nearby mainnet question is not captured",
    r?.id === "mainnet",
    r?.id,
  );
}
{
  /* The token topic now offers the purchase phrasing, which only became parseable
     with the `buy` verb — a card that fills the box with an unparseable sentence
     is worse than no card. */
  const buy = matchFaq("how do I get KLD")?.cards?.flatMap(
    (c) => c.actions?.map((a) => a.prompt) ?? [],
  );
  check(
    "the KLD answer offers a way to buy it",
    buy?.includes("buy KLD with 500 USDC"),
    JSON.stringify(buy),
  );
  /* And asking how to buy it lands on that answer rather than on the grammar's
     "which token do you want to spend?", which is a fair reply to an instruction
     and the wrong shape of reply to a question. */
  check("how to buy it", matchFaq("how do i buy kld")?.id === "kld");
  check("where to buy it", matchFaq("where can i buy kld")?.id === "kld");
}

console.log("\n— question-shaped, so the FAQ gets first refusal —");
for (const q of [
  "what is slippage",
  "why is my balance 0",
  "is there a limit on the faucet",
  "how often can I claim",
  "who are you",
  "am I close to liquidation",
  "does this cost real money",
  "can I withdraw to my bank",
]) {
  check(`"${q}"`, isQuestionShaped(q));
}

console.log("\n— an instruction is not a question, whatever it mentions —");
for (const c of [
  "swap 500 usdc to kld",
  "stake 100 KLD",
  "claim everything from the faucet",
  "show my address",
  "explain my health factor",
  "lend 1,000 USDC at 10% for 60 days",
  "unstake everything",
  "  mint 500 USDC",
]) {
  check(`"${c}"`, !isQuestionShaped(c));
}
check("empty string is not a question", !isQuestionShaped(""));
check(
  "a word that merely starts with an interrogative doesn't count",
  !isQuestionShaped("wholesale swap of 100 USDC"),
);

console.log("\n— every trigger can actually fire, given the routing order —");
{
  /* The parser is consulted first for anything not question-shaped, so a trigger
     it parses is a trigger that cannot fire on its own. Five are like that, each
     for a stated reason. Anything else appearing here is an unreachable trigger —
     write it as a question, or drop it. */
  const EXPECTED_SHADOWED = {
    // Imperatives. Someone typing these wants the transaction, not the paragraph,
    // and the parser giving them one is the correct outcome.
    "stake kld": "imperative",
    "mint kfusd": "imperative",
    // A noun phrase that nobody types alone: it arrives inside "is there a limit
    // on the faucet", which is question-shaped, so it reaches this file there.
    // Asserted just below rather than left as an argument.
    "limit on the faucet": "only occurs inside a question",
    /* Both open with the grammar's `swap` verb, so bare they are an incomplete
       swap — and would be with or without these triggers, since the grammar finds
       that verb anywhere in a sentence. They earn their place by the question
       forms, "what is the swap fee" and "why did my swap fail", which is where
       anyone actually types them. Asserted below. */
    "swap fee": "only occurs inside a question",
    "swap fail": "only occurs inside a question",
  };
  const TOKENS = [
    {
      address: "0xkld",
      name: "Kaleido",
      symbol: "KLD",
      decimals: 18,
      chainId: 84532,
    },
    {
      address: "0xusdc",
      name: "USD Coin",
      symbol: "USDC",
      decimals: 6,
      chainId: 84532,
    },
    {
      address: "0xweth",
      name: "Wrapped Ether",
      symbol: "WETH",
      decimals: 18,
      chainId: 84532,
    },
  ];
  const shadowed = [];
  for (const topic of FAQ_TOPICS) {
    for (const trigger of topic.triggers) {
      if (isQuestionShaped(trigger)) continue;
      if (parseCommand(trigger, TOKENS).status !== "unknown")
        shadowed.push(trigger);
    }
  }
  const unexpected = shadowed.filter((t) => !(t in EXPECTED_SHADOWED));
  check(
    "no trigger is silently shadowed by the command grammar",
    unexpected.length === 0,
    unexpected.join(", "),
  );
  check(
    "the shadowed noun phrase still fires inside its question",
    isQuestionShaped("is there a limit on the faucet") &&
      matchFaq("is there a limit on the faucet")?.id === "test-funds",
  );
  check(
    "the two swap-verb triggers still fire inside their questions",
    matchFaq("what is the swap fee")?.id === "fees" &&
      matchFaq("why did my swap fail")?.id === "tx-failed" &&
      isQuestionShaped("what is the swap fee") &&
      isQuestionShaped("why did my swap fail"),
  );

  /* A card can only fill the prompt box — clicking one submits the sentence as
     though the user typed it. So a chip whose prompt neither net can handle is a
     model request this file invited, on a phrasing we chose ourselves. Every one
     of them has to be answerable locally: parsed by the grammar, or question-
     shaped and matched here. */
  const unhandled = [];
  for (const topic of FAQ_TOPICS) {
    for (const card of topic.cards ?? []) {
      for (const action of card.actions ?? []) {
        const local =
          parseCommand(action.prompt, TOKENS).status !== "unknown" ||
          (isQuestionShaped(action.prompt) && matchFaq(action.prompt) !== null);
        if (!local) unhandled.push(`${topic.id}: ${action.prompt}`);
      }
    }
  }
  check(
    "every chip we offer is a sentence one of the two local nets can answer",
    unhandled.length === 0,
    unhandled.join(" | "),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
