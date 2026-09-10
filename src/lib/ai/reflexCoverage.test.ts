// What fraction of a newcomer's first conversation does the local reflex answer?
//
// Run with plain node, same as the rest. This is a coverage floor, not a unit
// test: it pushes a corpus of plausible first-touch prompts through the exact
// two nets the agent page uses, in the page's order, and fails if the reflex
// stops catching them. The point is that "widen the FAQ" stops being guesswork —
// the miss list it prints IS the next work item.
//
// Measured 2026-09-03, before the widening: 44% overall, 31% of the questions.
// After: 78% and 87%. Then the portfolio read and the funding phrasings landed and
// the corpus grew by twelve to measure them: 49/56, 88%. Then three topics that a
// model answers *worse* than a fixed paragraph does — a failed transaction, the fee
// schedule, and the APY question whose true answer is that there is no number —
// took it to 53/56, 95%. The three left are open for reasons no topic fixes: one
// needs a cost basis nothing records, and two are asked upstream of this screen.
// The add-liquidity handoff then brought its own prompt and answered it, 54/57 —
// and it is the grammar, not the FAQ, that answers it. That is the shape of what
// is left here: the remaining ground is reached by the parser learning another
// destination, not by another paragraph.
// The floors below sit under those, deliberately loose, so that adding a new corpus
// prompt with no topic behind it is a nudge rather than a broken build — but losing
// a whole topic, or a chip falling through to the model, fails immediately. The
// section at the foot is where the exact routing is pinned.
import { matchFaq, isQuestionShaped } from "./faq.ts";
import { MIN_ASK_SIMILARITY, searchDocs } from "./docsSearch";
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
    /* Mirrors the page: a question with an exact docs ask is a question
       about the action, checked before the grammar can read its verb. */
    const exact = searchDocs(text);
    if (exact && exact.via === "ask" && exact.score >= MIN_ASK_SIMILARITY && (exact.shared ?? 0) >= 2) return `docs:${exact.slug}`;
  }
  const parsed = parseCommand(text, VOCAB);
  if (parsed.status === "ok") return `command:${parsed.command.kind}`;
  if (parsed.status === "incomplete") return `asks:${parsed.missing}`;
  const faq = matchFaq(text);
  if (faq) return `faq:${faq.id}`;
  /* Third net, in the page's order: only what the FAQ and the grammar both
     declined. A docs hit is local and cited; null is the model. */
  const doc = searchDocs(text);
  return doc ? `docs:${doc.slug}` : null;
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
// reflex. This comment used to claim that diagnosing a failed transaction should
// reach the model because it needs the actual revert reason — which was the wrong
// conclusion from a true premise: the model has no access to that reason either.
// It cannot see the toast, the revert data or the wallet's refusal, so it answers
// with generic causes at the cost of a metered request. The local topic lists the
// same five causes accurately, and points at the toast, which does have the reason.
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
  /* Question-shaped and answered by the *grammar*, which is the ordering working
     as designed rather than an accident: no topic explains adding liquidity as
     well as the form that does it, so the miss falls through to the net that
     opens the form. */
  "how do I add liquidity",
  "what happens if I get liquidated",
  "what is a health factor",
  "is there an airdrop",
  "how do I get KLD",
  "how do I buy KLD",
  "is this audited",
  "do you have a token",
  "where are the docs",
  "how do I report a bug",
  "the transaction failed, why",
  "my transaction is stuck",
  "what are the fees",
  "what is the APY",
  /* Newcomer phrasings that reached the model until the FAQ learned them: the fee
     question worded as a verb, the unstake flow (which has no grammar verb behind
     it), and the skeptic's "is any of this real / can I lose money". */
  /* The first thing anyone types, and until 2026-09-10 the local nets caught
     none of it: a bare greeting matched no verb and no trigger, so "hi" cost a
     reasoning request - and when the model was down it was answered with "the
     reasoning service returned an error". Pinned here because a corpus that
     covers "how do I unstake" but not "hi" is measuring the wrong end of the
     funnel. */
  "hi",
  "hey luca",
  "gm",
  "how do fees work",
  "how do I unstake",
  "can I lose money",
  "is my money safe",
  /* Asking what you hold. Absent from this corpus until the read existed, which
     means the percentage above it never measured the single most-asked thing —
     so they are here now whether or not they pass. "am I in profit" is the one
     that will stay open: it needs a cost basis, and nothing in the app records
     what anyone paid, so the model cannot answer it either. */
  "what are my balances",
  "show my portfolio",
  "show my positions",
  "what do I have",
  "how much is my portfolio worth",
  "do I have any positions",
  "am I in profit",
  /* Asking to be given something, which is a request wearing a question's clothes.
     The grammar has one faucet word, so these depend entirely on the FAQ. */
  "give me some USDC",
  "fund my wallet",
  "my wallet is empty",
  "I need test ETH",
  // Both of these are asked at the gate, which is upstream of this screen — you
  // cannot reach Luca without already having entered a working code. Kept in the
  // corpus because they are real questions from real registrants; they belong in
  // the invite email and the docs, not in a topic here.
  "how do I get the access code",
  "my access code doesn't work",
  /* Written from three registers - first-timer, DeFi-native, large holder -
     after the docs net landed. Every one of these used to reach the model.
     They are here so the docs net is measured on questions the FAQ never
     learned, not only on the ones it did. */
  "how do fees work on swaps",
  "is there a fee to unstake",
  "what is the unstaking cooldown",
  "how do i get my kld back",
  "why has my stkld not grown",
  "what is the difference between kfusd and kafusd",
  "does unlocking kafusd give me usdc back",
  "how is the liquidation penalty split",
  "how much can i borrow against my collateral",
  "is the lending rate apr or apy",
  "can i repay part of my loan",
  "what happens when my lp position goes out of range",
  "why did my range snap to different prices",
  "do lp fees compound",
  "which fee tier does the swap page use",
  "why does the agent get a better price than the page",
  "can the agent swap without me",
  "how do i revoke the agent",
  "what oracle do you use",
  "how much kld unlocks at tge",
  "is kld a governance token",
  "when is the exchange listing",
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
    /* Found by the shadowing check while the fees topic was being written: this
       is question-shaped, so the FAQ has first refusal, but with only the plural
       "any fees" as a trigger it missed and the grammar took the sentence for its
       `stake` verb — "how much KLD do you want to stake?" in answer to a question
       about cost. It is here because a singular/plural slip is exactly the kind of
       near-miss that reopens this failure quietly. */
    "is there any fee to stake",
  ];
  for (const q of asked) {
    const r = route(q);
    check(`"${q}" -> ${r}`, String(r).startsWith("faq:"), String(r));
  }
}

/* The percentage above is a trend line and is deliberately loose. These are the
   sharp checks: each says not merely that a prompt is answered locally, but which
   of the two nets answers it. Both directions have been wrong before — a balance
   question answered with a transaction plan, and a request for test funds answered
   with "which marketplace request do you want to fill?". */
console.log("\n— a sentence the grammar cannot read is not half-read into a plan —");
{
  /* Each of these parsed as SOMETHING before the MODEL_ONLY decline: a recurring
     buy as a one-off swap, a limit order as a swap missing its input, a
     delegation grant as a lend missing its rate. A plan the user did not
     describe is worse than no plan. They reach the model. */
  const misread = [
    "buy 50 KLD every week with USDC",
    "place a limit order to buy 100 KLD at 0.02 USDC",
    "cancel all my orders",
    "grant the agent permission to lend up to 5000 USDC",
    "dca 20 USDC into KLD daily",
  ];
  for (const q of misread) {
    const r = route(q);
    check(`"${q}" -> ${r ?? "the model"}`, !String(r).startsWith("command:") && !String(r).startsWith("asks:"), String(r));
  }
}

console.log("\n— and the right net answers it —");
{
  const ROUTES = {
    // Reads. The grammar owns these because it resolves them to a command the page
    // short-circuits, not to a plan.
    "what are my balances": "command:portfolio",
    "show my portfolio": "command:portfolio",
    "do I have any KLD": "command:portfolio",
    // Prose. Nothing to build, so a paragraph with a chip on it is the answer.
    "give me some USDC": "faq:test-funds",
    "fund my wallet": "faq:test-funds",
    "how do I buy KLD": "faq:kld",
    /* The three newest topics, pinned by id rather than left to the percentage
       above. Each was a model call until now, and each is a question a model
       answers *worse* than a fixed paragraph does: it cannot see the failure, and
       it will quote a fee schedule or an APY from general DeFi rather than from
       this protocol. The first is also the only pin here whose text is not
       question-shaped, so it proves the grammar declines it before the FAQ is
       asked at all. */
    "the transaction failed, why": "faq:tx-failed",
    "my transaction is stuck": "faq:tx-failed",
    "what are the fees": "faq:fees",
    "what is the APY": "faq:apy",
    /* The phrasings the FAQ just learned — pinned by id so a reworded trigger
       that stops catching them fails here, not silently at a tester's screen. */
    "hi": "faq:greeting",
    "hey luca": "faq:greeting",
    "gm": "faq:greeting",
    "how do fees work": "faq:fees",
    "what is the unstaking cooldown": "faq:staking",
    "how do i get my kld back": "docs:stake",
    "how is the liquidation penalty split": "faq:health-factor",
    "can the agent swap without me": "docs:delegation",
    "what oracle do you use": "docs:architecture",
    "how much kld unlocks at tge": "docs:token",
    "how do I unstake": "faq:staking",
    "can I lose money": "faq:mainnet",
    // Still a transaction, and still the grammar's.
    "buy KLD with 500 USDC": "command:swap",
    "claim everything from the faucet": "command:claimTestTokens",
    /* A read must not swallow a stated action, whatever it mentions. This was
       pinned to the model until the add-liquidity handoff existed; the check is
       the same one and the answer got better, because "portfolio" no longer has
       to be the most specific thing in the sentence for it to be routed. What it
       still proves is that PORTFOLIO_VETO holds — the read never claims it. */
    "add liquidity to my portfolio": "command:openLiquidity",
    /* The handoff itself, pinned by kind. The grammar answers it and must: the
       form it opens is the one screen that collects a range and both amounts,
       so a model call here would end in the same place having cost a request. */
    "add liquidity to KLD/USDC": "command:openLiquidity",
    // But only where nothing was priced. With an amount in it, it is a plan.
    "add 500 USDC and 100 KLD to the KLD/USDC pool": null,
  };
  for (const [text, want] of Object.entries(ROUTES)) {
    const got = route(text);
    check(`"${text}" -> ${want ?? "the model"}`, got === want, String(got));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
