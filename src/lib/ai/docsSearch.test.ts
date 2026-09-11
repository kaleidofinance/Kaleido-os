/**
 * The docs net: does a question reach the section that answers it, and only when
 * it should?
 *
 * Run with `npx tsx src/lib/ai/docsSearch.test.ts`.
 *
 * Four things are pinned here, and the order they are listed in is the order
 * they matter:
 *
 * 1. EVERY BANK ENTRY RESOLVES. docsAsks.ts keys sections by slug and heading
 *    anchor. A heading renamed in docs/product/ silently orphans its asks - the
 *    runtime skips them rather than throwing - so this is where that shows up.
 * 2. THE INDEX IS CURRENT. docsIndex.generated.ts is committed, not built, so
 *    a docs edit without `npm run gen:docs` would have Luca quoting a paragraph
 *    the docs no longer say. The generator is re-run to a temp path and diffed.
 * 3. QUESTIONS LAND ON THE RIGHT PAGE, through the page's real ordering. The
 *    FAQ gets its chance first and the grammar second, exactly as on the agent
 *    page, because the docs net's safety property is that it only ever sees
 *    what both refused. A must-hit that the FAQ answers instead is not a
 *    failure of this net; a must-miss that the grammar catches is the ordering
 *    working. Both are asserted as what actually happens, not what this module
 *    would do alone.
 * 4. THE THRESHOLDS ARE EVIDENCE, NOT TASTE. The must-miss list is what pins
 *    MIN_ASK_SIMILARITY and MIN_SCORE. Lower either and a leak appears here
 *    before it appears in a transcript.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chainTokens } from "../../constants/tokens.ts";
import { parseCommand } from "../v2/intents/fromCommand.ts";
import { DOC_ASKS } from "./docsAsks.ts";
import { DOC_INDEX } from "./docsIndex.generated.ts";
import { docsReply, groundingFor, MIN_ASK_SIMILARITY, outageReply, searchDocs } from "./docsSearch.ts";
import { isQuestionShaped, matchFaq } from "./faq.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got === undefined ? "" : ` ${got}`}`);
  }
};

const VOCAB = chainTokens(84532);

/** The agent page's ordering, mirrored. Returns which net answers, or "model". */
function route(text: string): string {
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
  const doc = searchDocs(text);
  return doc ? `docs:${doc.slug}` : "model";
}

function main() {
  console.log("\n— every bank entry names a real section —");
  {
    const keys = new Set(DOC_INDEX.map((s) => `${s.slug}#${s.anchor}`));
    const orphans = DOC_ASKS.filter((a) => !keys.has(`${a.slug}#${a.anchor}`)).map(
      (a) => `${a.slug}#${a.anchor}`,
    );
    check(`all ${DOC_ASKS.length} bank entries resolve`, orphans.length === 0, orphans.join(", "));
    const empty = DOC_ASKS.filter((a) => a.asks.length === 0).map((a) => `${a.slug}#${a.anchor}`);
    check("no bank entry is empty", empty.length === 0, empty.join(", "));
    const dupes = new Map<string, number>();
    for (const a of DOC_ASKS) for (const q of a.asks) dupes.set(q, (dupes.get(q) ?? 0) + 1);
    const repeated = [...dupes].filter(([, n]) => n > 1).map(([q]) => q);
    check("no ask appears under two sections", repeated.length === 0, repeated.join(" | "));
  }

  console.log("\n— the committed index matches the docs —");
  {
    const tmp = join(tmpdir(), `docs-index-${process.pid}.ts`);
    try {
      execFileSync("node", ["--import", "tsx", "scripts/gen-docs-index.mjs"], {
        env: { ...process.env, OUT: tmp },
        stdio: "pipe",
      });
      const fresh = readFileSync(tmp, "utf8").replace(/\r\n/g, "\n");
      const committed = readFileSync("src/lib/ai/docsIndex.generated.ts", "utf8").replace(/\r\n/g, "\n");
      check(
        "docsIndex.generated.ts is what gen:docs would write now",
        fresh === committed,
        "run `npm run gen:docs` and commit the result",
      );
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        /* never written */
      }
    }
    check(`index has sections (${DOC_INDEX.length})`, DOC_INDEX.length > 50);
    const blank = DOC_INDEX.filter((s) => !s.text.trim()).length;
    check("no section is empty", blank === 0, `${blank} blank`);
  }

  console.log("\n— a question reaches the page that answers it (page ordering) —");
  {
    const HIT: [string, string][] = [
      ["how do fees work on swaps", "faq:fees"],
      ["what does it cost to swap", "faq:fees"],
      ["is there a fee to unstake", "faq:fees"],
      ["how do I get gas", "faq:test-funds"],
      ["what is a health factor", "faq:health-factor"],
      ["how is the liquidation penalty split", "faq:health-factor"],
      ["how much can i borrow against my collateral", "docs:borrow"],
      ["how is collateral valued", "docs:borrow"],
      ["is the lending rate apr or apy", "faq:apy"],
      ["can i repay part of my loan", "docs:borrow"],
      ["what is the unstaking cooldown", "faq:staking"],
      ["how do i get my kld back", "docs:stake"],
      ["why has my stkld not grown", "faq:staking"],
      ["can I withdraw part of my stake", "docs:stake"],
      ["what is the difference between kfusd and kafusd", "faq:kafusd"],
      /* "give me" is a two-word FAQ trigger and it catches this sentence; see the
         follow-up on trigger specificity. Phrased here without the collision. */
      /* "kafusd" is a one-word FAQ trigger, so any sentence naming the token gets
         the kafUSD overview first. Not wrong - but the docs section on unlocking is
         the precise answer, and it never gets asked. Recorded as the trigger
         specificity follow-up alongside "give me" and "when is the token". */
      ["does unlocking kafusd return my usdc", "faq:kafusd"],
      ["how do I mint kfusd", "faq:kfusd"],
      ["what happens when my lp position goes out of range", "docs:liquidity"],
      ["why did my range snap to different prices", "docs:liquidity"],
      ["do lp fees compound", "docs:liquidity"],
      ["how do I collect LP fees", "docs:liquidity"],
      ["which fee tier does the swap page use", "docs:trade"],
      ["why does the agent get a better price than the page", "docs:trade"],
      ["slippage on swaps?", "docs:trade"],
      ["can the agent swap without me", "docs:delegation"],
      ["how do i revoke the agent", "docs:delegation"],
      ["what is delegation", "docs:delegation"],
      ["what oracle do you use", "docs:architecture"],
      ["how are prices sourced", "docs:architecture"],
      /* The mainnet topic owns "when is the token", and a "when" about the token is
         its question to answer first; the unlock table is one link further. */
      ["when is the token unlock", "faq:mainnet"],
      ["when is the exchange listing", "docs:roadmap"],
      ["which chains are supported", "faq:chains"],
      ["why does Arc use USDC for gas", "docs:overview"],
      ["how does the agent work", "docs:agent"],
      ["what is Kaleido", "faq:orientation"],
    ];
    for (const [q, want] of HIT) {
      const r = route(q);
      check(`"${q}" -> ${want}`, r === want, r);
    }
  }

  console.log("\n— phrasings the bank never saw still land (generalisation) —");
  {
    const GEN: [string, string][] = [
      ["yo how do i get my kld out of staking", "docs:stake"],
      ["explain the health factor thing to me", "faq:health-factor"],
      ["is my collateral safe if price drops", "docs:borrow"],
      ["whats the deal with two signatures on a swap", "docs:getting-started"],
      ["can the agent swap on its own while im asleep", "docs:delegation"],
      ["how much can i borrow", "docs:borrow"],
    ];
    for (const [q, want] of GEN) {
      const r = route(q);
      check(`"${q}" -> ${want}`, r === want, r);
    }
  }

  console.log("\n— what must never come back as a docs quote —");
  {
    /* Imperatives are the grammar's, by ordering; the rest must score below the
       thresholds on their own merits. Both kinds are listed because both have
       leaked before: an imperative when the net was tested alone, and chatter
       when MIN_ASK_SIMILARITY sat at 0.5. */
    const MISS = [
      "stake 100 KLD",
      "swap 50 USDC for KLD",
      "lend 1000 USDC at 8% for 30 days",
      "show my portfolio",
      "hi",
      "thanks",
      "ok cool",
      "lol",
      "what time is it",
      "tell me a joke",
      "who won the game last night",
      "what is the weather",
      "how are you today",
      "cancel",
      "yes",
      "no thanks",
    ];
    for (const q of MISS) {
      const r = route(q);
      check(`"${q}" is not a docs answer (${r})`, !r.startsWith("docs:"), r);
    }
  }

  console.log("\n— a question about live state is never answered from a page —");
  {
    /* Found by routing every advertised READ tool's own prompt: two of them were
       being answered by static docs. A quoted paragraph about the faucet is not
       an answer to "where is my USDC", and the getting-started page is not who
       is lending right now. These must reach the model, whose read tools are
       the only honest source. The bank is curated to exclude such asks; this
       pins the prose fallback to the same rule. */
    const LIVE = [
      "who's lending USDC right now, and at what rate?",
      "where is my USDC?",
      "what's ETH worth today?",
      "what orders do I have resting?",
      "what is the price of KLD right now",
      "how much is my position worth",
    ];
    for (const q of LIVE) {
      const r = route(q);
      check(`"${q}" -> ${r}`, !r.startsWith("docs:"), r);
    }
  }

  console.log("\n— the reply cites, it does not paraphrase —");
  {
    const hit = searchDocs("how long is the unstaking cooldown");
    check("a hit has a docs href", !!hit && hit.href.startsWith("/docs/stake"), hit?.href);
    check("the excerpt is the section's own text", !!hit && DOC_INDEX.some((s) => s.text.startsWith(hit.text.replace(/ …$/, ""))));
    if (hit) {
      const r = docsReply(hit);
      check("the reply is framed as a quotation", r.text.startsWith("From the docs —"));
      check("and carries the link", r.link.href === hit.href);
    }
    const o = outageReply("how does staking work");
    check("the outage reply says the model is unavailable", o.text.includes("unavailable"));
    check("and still offers the closest docs section", !!o.link && o.link.href.startsWith("/docs/"));
    const g = groundingFor("what is a health factor", 2);
    check("grounding returns distinct sections", g.length === 2 && g[0].href !== g[1].href, g.map((x) => x.href).join(", "));

    /* A question the docs do not answer gets NO quote. This used to fall back
       to groundingFor, which accepts any section sharing one term because a
       loose passage handed silently to a model costs nothing. Shown to a
       person it is a confident non-answer: asked to "make me a volume of
       $100,000" it quoted the KLD supply table, matched on the digits. */
    const miss = outageReply("make me a volume of $100,000");
    check("an unanswerable question is not quoted at", !miss.text.includes("›"), miss.text.slice(0, 90));
    check("and does not reach for the supply table", !/200,000,000|Bucket/.test(miss.text), miss.text.slice(0, 90));
    check("it still points at the docs", miss.link?.href === "/docs", miss.link?.href);
    check("and still says the model is unavailable", miss.text.includes("unavailable"));

    /* Grounding itself is unchanged - it is allowed to be loose, because what
       does not help is discarded by the model rather than read by a person.
       The point is that the two paths DIVERGE on this question: grounding
       still finds something, and the outage reply still declines to quote it. */
    check(
      "grounding is still loose where the quote is not",
      groundingFor("make me a volume of $100,000", 1).length === 1 && !miss.text.includes("›"),
    );

    /* No reply ever prints a bare route. In a chat box a leading slash reads
       as a command the user could type, and "/docs" is not one. */
    for (const q of ["how does staking work", "make me a volume of $100,000"]) {
      const o = outageReply(q);
      check(`"${q}" prints no bare route`, !/(^|[\s(])\/docs/.test(o.text), o.text.slice(0, 90));
    }
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
