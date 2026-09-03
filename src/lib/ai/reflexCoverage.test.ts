// What fraction of a newcomer's first conversation does the local reflex answer?
//
// Run with plain node, same as the rest. This is a coverage floor, not a unit
// test: it pushes a corpus of plausible first-touch prompts through the exact
// two nets the agent page uses, in the page's order, and fails if the reflex
// stops catching them. The point is that "widen the FAQ" stops being guesswork —
// the miss list it prints IS the next work item.
//
// Measured 2026-09-03, before the widening: 44% overall, 31% of the questions.
// After: 78% and 87%. The floors below sit under those, deliberately loose, so
// that adding a new corpus prompt with no topic behind it is a nudge rather than
// a broken build — but losing a whole topic, or a chip falling through to the
// model, fails immediately.
import { matchFaq, isQuestionShaped } from "./faq.ts";
import { parseCommand } from "../v2/intents/fromCommand.ts";
import { chainTokens } from "../../constants/tokens.ts";

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

// Base Sepolia, because that is the chain the invite email tells them to start on.
const VOCAB = chainTokens(84532);

// The page's routing, in one place so this file cannot drift from it: the FAQ gets
// first refusal on a question, the grammar on anything else, and either miss falls
// through to the other before the model does any work.
function route(text) {
  if (isQuestionShaped(text)) {
    const faq = matchFaq(text);
    if (faq) return `faq:${faq.id}`;
  }
  const parsed = parseCommand(text, VOCAB);
  if (parsed.status === "ok") return `command:${parsed.command.kind}`;
  if (parsed.status === "incomplete") return `asks:${parsed.missing}`;
  const faq = matchFaq(text);
  return faq ? `faq:${faq.id}` : null;
}

// The seven chips the empty state offers. A miss here is a defect, not a gap:
// the app suggested the sentence, so it must answer it without a model call.
const CHIPS = [
  "claim everything from the faucet",
  "swap 500 USDC to KLD",
  "stake 100 KLD",
  "mint 500 USDC",
  "lend 1,000 USDC at 10% for 60 days",
  "borrow 500 USDC at 8% for 30 days",
  "show my address",
];

// The two examples the invite email prints. Whatever the email promises to 3,000
// people, the reflex has to honour verbatim.
const EMAIL_EXAMPLES = ["swap 50 USDC for ETH", "lend 100 USDC at 8%"];

// What someone who has just entered an access code types. Not a wish list: every
// line here is either a phrasing of something the app does, or a question the
// invite email and the faucet's own shape provoke.
//
// It deliberately includes the ones that still reach the model. Trimming those
// would make the percentage a statement about this list rather than about the
// reflex, and two of them SHOULD reach the model: diagnosing a failed transaction
// needs the actual revert reason, which no fixed paragraph has.
const QUESTIONS = [
  "how do I get test tokens",
  "where is the faucet",
  "why is my balance 0",
  "which network should I use",
  "how do I get gas",
  "I have no ETH for gas",
  "what is KLD",
  "when is mainnet",
  "is this real money",
  "do I need real ETH",
  "how do I connect my wallet",
  "which wallet do you support",
  "is my wallet safe",
  "what can you do",
  "what is this app",
  "how do I start",
  "what should I do first",
  "how do I add Base Sepolia to my wallet",
  "how long does a swap take",
  "is there a limit on the faucet",
  "how often can I claim",
  "how do I earn points",
  "where is the leaderboard",
  "am I on the leaderboard",
  "how many requests do I get a day",
  "why did you stop answering me",
  "who are you",
  "are you an AI",
  "what is Luca",
  "how do I lend",
  "what happens if I get liquidated",
  "what is a health factor",
  "is there an airdrop",
  "how do I get KLD",
  "is this audited",
  "do you have a token",
  "where are the docs",
  "how do I report a bug",
  "the transaction failed, why",
  "my transaction is stuck",
  "what are the fees",
  "what is the APY",
  // Both of these are asked at the gate, which is upstream of this screen — you
  // cannot reach Luca without already having entered a working code. Kept in the
  // corpus because they are real questions from real registrants; they belong in
  // the invite email and the docs, not in a topic here.
  "how do I get the access code",
  "my access code doesn't work",
];

console.log("\n— every suggestion chip is answered locally —");
for (const chip of CHIPS) {
  const r = route(chip);
  check(`"${chip}"`, r !== null, "reached the model");
}

console.log("\n— the invite email's own examples plan locally —");
for (const example of EMAIL_EXAMPLES) {
  const r = route(example);
  check(`"${example}"`, r !== null && r !== "MODEL", String(r));
}

console.log("\n— first-touch questions —");
{
  const missed = QUESTIONS.filter((q) => route(q) === null);
  const covered = QUESTIONS.length - missed.length;
  const pct = Math.round((covered / QUESTIONS.length) * 100);
  console.log(`  ${covered}/${QUESTIONS.length} answered locally (${pct}%)`);
  if (missed.length) {
    console.log("  reaching the model — a candidate topic, or genuinely open:");
    for (const m of missed) console.log(`    ${m}`);
  }
  check(`at least 80% (${pct}%)`, pct >= 80);
}

console.log("\n— a question never answers with a transaction —");
{
  /* The failure this ordering exists to prevent: text that asks something,
     parsed as an instruction, answered with signable steps. Each of these
     parsed as a command before the FAQ got first refusal. */
  const asked = [
    "is there a limit on the faucet",
    "how often can I claim",
    "why is my balance 0",
    "who are you",
    "is this real money",
  ];
  for (const q of asked) {
    const r = route(q);
    check(`"${q}" -> ${r}`, String(r).startsWith("faq:"), String(r));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
