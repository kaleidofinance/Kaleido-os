/**
 * Answer a question from the docs, locally, by citing the section that answers it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The agent page has two local nets before the cloud model: a command grammar
 * and a hand-written FAQ of ~20 topics matched by substring. Between them they
 * answer 95% of a corpus WE wrote — which says nothing about the sentence a
 * newcomer actually types. Every miss is a model call: a credit spent, and when
 * the account has none, "the reasoning service returned an error" in reply to
 * "how do fees work". The docs already answer that, precisely.
 *
 * This is the third net. It returns the docs' own section VERBATIM with a link
 * to it. It never paraphrases: a local answer that invents a detail is worse
 * than escalating, because the user cannot tell the two apart and the model at
 * least has the position data.
 *
 * ---------------------------------------------------------------------------
 * TWO STAGES, AND WHY THE FIRST ONE EXISTS
 * ---------------------------------------------------------------------------
 * Stage 1 matches the question against a BANK OF QUESTIONS (docsAsks.ts): for
 * every section, the sentences people type to reach it. Scoring prose alone
 * landed on the right page 14 times in 33, and the misses were a vocabulary
 * gap, not a scoring one — "how do I get my KLD back" is answered by a section
 * titled "Leaving takes three moves" that never says "unstake". Question
 * against question, the overlap is high; question against paragraph, it is
 * not. Stage 2 is field-weighted BM25 over the prose, for what the bank did
 * not anticipate — and every stage-2 hit is a candidate for the bank.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT SITS, AND WHY NOT EARLIER
 * ---------------------------------------------------------------------------
 * After the FAQ (curated answers beat retrieved ones) and after the grammar has
 * DECLINED the sentence. That second condition is the safety property: "stake
 * 100 KLD" must never come back as a paragraph about staking, and the only
 * reliable guarantee is that the parser saw it first. So this net only ever
 * sees what both others refused — exactly the set that used to reach the model.
 */
import { DOC_ASKS } from "./docsAsks";
import { DOC_DF, DOC_INDEX, DOC_INDEX_STATS, type DocSection } from "./docsIndex.generated";
import { tokenize } from "./docsTokens";

export interface DocHit {
  slug: string;
  title: string;
  heading: string;
  /** `/docs/<slug>` or `/docs/<slug>#<anchor>` — the section the site draws. */
  href: string;
  /** The section's own words, cut at a sentence boundary. Never rewritten. */
  text: string;
  /** Which stage answered. `ask` is the bank, `prose` the fallback scorer. */
  via: "ask" | "prose";
  /** The bank sentence that matched, or the query terms the prose contained. */
  matched: string[];
  score: number;
  /**
   * Content terms the question and the bank ask had in common. Only set for a
   * bank hit. The pre-grammar diversion requires two: "do I have any KLD"
   * shares one word with "what is kld" and scores 0.67, and one word is not
   * evidence that a question is about the docs rather than about a balance.
   */
  shared?: number;
}

/* ---------------------------------------------------------------- stage 1 -- */

/**
 * Words that shape a question without saying what it is about. Removed before
 * comparing to the bank so "how does staking actually work" and "how does
 * staking work" are the same sentence. Kept apart from the index tokenizer's
 * stop list on purpose: that one must stay short so the PROSE scorer does not
 * go blind on "fee" or "rate"; this one is only ever applied to questions.
 */
const QUESTION_NOISE = new Set(
  "actually anyone anything can could exactly explain get give happen happens here how i im just know like me mean means my need please really should tell the there thing things to us want way what whats when where which who why work works would you your".split(" "),
);

function askTerms(text: string): string[] {
  return [...new Set(tokenize(text).filter((t) => !QUESTION_NOISE.has(t)))];
}

/** Dice coefficient over content terms — symmetric, length-tolerant, cheap. */
function similarity(a: string[], b: string[]): { score: number; shared: number } {
  if (a.length === 0 || b.length === 0) return { score: 0, shared: 0 };
  const bs = new Set(b);
  let shared = 0;
  for (const t of a) if (bs.has(t)) shared++;
  return { score: (2 * shared) / (a.length + b.length), shared };
}

/**
 * The bank, pre-tokenized once. Every entry is validated against the index at
 * module load in tests (docsSearch.test.ts), so a renamed heading fails loudly
 * instead of leaving an ask that resolves to nothing.
 */
const BANK: { section: DocSection; ask: string; terms: string[] }[] = [];
{
  const byKey = new Map<string, DocSection>();
  for (const s of DOC_INDEX) byKey.set(`${s.slug}#${s.anchor}`, s);
  for (const entry of DOC_ASKS) {
    const section = byKey.get(`${entry.slug}#${entry.anchor}`);
    if (!section) continue; // the test reports it; the runtime must not throw
    for (const ask of entry.asks) BANK.push({ section, ask, terms: askTerms(ask) });
  }
}

/** A bank match must be at least this similar. Pinned by the test's must-miss list. */
export const MIN_ASK_SIMILARITY = 0.6;

function searchBank(
  question: string,
): { section: DocSection; ask: string; score: number; shared: number } | null {
  const q = askTerms(question);
  if (q.length === 0) return null;
  let best: { section: DocSection; ask: string; score: number; shared: number } | null = null;
  for (const b of BANK) {
    const s = similarity(q, b.terms);
    if (s.score > (best?.score ?? 0)) best = { section: b.section, ask: b.ask, ...s };
  }
  return best && best.score >= MIN_ASK_SIMILARITY ? best : null;
}

/* ---------------------------------------------------------------- stage 2 -- */

const K1 = 1.2;
const B = 0.75;
const N = DOC_INDEX.length;
/** Title and heading terms count this many times a body term. */
const W_TITLE = 3;
const W_HEAD = 2;

/** Minimum share of the question's content terms the section must contain. */
export const MIN_COVERAGE = 0.6;
/** Minimum weighted BM25 score. Tuned against the test's must-miss list. */
export const MIN_SCORE = 6;
const QUOTE_CHARS = 720;

function idf(term: string): number {
  const df = DOC_DF[term] ?? 0;
  return Math.log((N - df + 0.5) / (df + 0.5) + 1);
}

function scoreProse(section: DocSection, query: string[]): { score: number; matched: string[] } {
  const tf = new Map<string, number>();
  for (const t of section.bodyTerms) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const t of section.headTerms) tf.set(t, (tf.get(t) ?? 0) + W_HEAD);
  for (const t of section.titleTerms) tf.set(t, (tf.get(t) ?? 0) + W_TITLE);
  const norm = 1 - B + (B * section.bodyTerms.length) / DOC_INDEX_STATS.avgLen;
  let score = 0;
  const matched: string[] = [];
  for (const q of query) {
    const f = tf.get(q);
    if (!f) continue;
    matched.push(q);
    score += idf(q) * ((f * (K1 + 1)) / (f + K1 * norm));
  }
  return { score, matched };
}

/**
 * Questions about the user's own state, or the market right now, which no
 * static page can answer.
 *
 * The bank is curated and its rules exclude these, so a bank hit is safe. The
 * prose scorer has no such judgement: it matched "who's lending USDC right
 * now" to the getting-started page and "where is my USDC" to the faucet
 * section - confident, well-cited, and wrong in the way that matters most,
 * because the user cannot tell a quoted paragraph from a read of their
 * position. So the prose stage declines anything that names the asker's own
 * holdings or the present moment, and those questions go on to the model,
 * whose read tools are the only honest answer.
 *
 * READ-shaped, not merely possessive. "how do I get my KLD out of staking" is
 * a how-to that happens to say "my", and the docs answer it well; "where is
 * my USDC" is a read. The first cut keyed on "my" alone and blocked the
 * how-to. The markers below are the shapes a request for live state takes -
 * openers ("where is my", "do I have"), the present moment, or a value. A bare
 * "my <noun>" is deliberately NOT one: "can I repay part of my loan" is a
 * how-to about repaying, and blocking it sent the sentence to the grammar,
 * which read it as a repay transaction - the exact misroute the bank fixes.
 */
const LIVE_STATE =
  /\b(where (is|are) my|how much (is|are|do i have|have i)|what('s| is| are) my|do i have|have i got|am i|right now|currently|today|at the moment|resting|worth|price of)\b/i;

function searchProse(question: string): { section: DocSection; score: number; matched: string[] } | null {
  const query = askTerms(question);
  if (query.length === 0) return null;
  let best: { section: DocSection; score: number; matched: string[] } | null = null;
  for (const section of DOC_INDEX) {
    const r = scoreProse(section, query);
    if (r.score > (best?.score ?? 0)) best = { section, ...r };
  }
  if (!best) return null;
  const coverage = best.matched.length / query.length;
  return coverage >= MIN_COVERAGE && best.score >= MIN_SCORE ? best : null;
}

/* ------------------------------------------------------------------ public -- */

/** Cut at the last sentence end before the limit, so a quote never trails off mid-clause. */
function excerpt(text: string): string {
  if (text.length <= QUOTE_CHARS) return text;
  const head = text.slice(0, QUOTE_CHARS);
  const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf(".\n"), head.lastIndexOf("\n\n"));
  return (cut > QUOTE_CHARS / 3 ? head.slice(0, cut + 1) : head).trimEnd() + " …";
}

function toHit(section: DocSection, via: DocHit["via"], matched: string[], score: number): DocHit {
  return {
    slug: section.slug,
    title: section.title,
    heading: section.heading,
    href: section.anchor ? `/docs/${section.slug}#${section.anchor}` : `/docs/${section.slug}`,
    text: excerpt(section.text),
    via,
    matched,
    score,
  };
}

export function searchDocs(question: string): DocHit | null {
  /* Both stages, not just prose. A one-word bank overlap ("usdc") had let
     "where is my USDC" through the bank stage to a faucet section, which the
     prose guard never saw. A live-state question is a false match against ANY
     page by definition - the bank's own rules exclude such asks. */
  if (LIVE_STATE.test(question)) return null;
  const bank = searchBank(question);
  if (bank) return { ...toHit(bank.section, "ask", [bank.ask], bank.score), shared: bank.shared };
  const prose = searchProse(question);
  if (prose) return toHit(prose.section, "prose", prose.matched, prose.score);
  return null;
}

/** Up to `n` distinct sections, for grounding a model turn. Never used to answer. */
export function groundingFor(question: string, n = 2): DocHit[] {
  const query = askTerms(question);
  if (query.length === 0) return [];
  const scored = DOC_INDEX.map((section) => ({ section, ...scoreProse(section, query) }))
    .filter((r) => r.matched.length > 0)
    .sort((a, b) => b.score - a.score);
  const out: DocHit[] = [];
  const seen = new Set<string>();
  for (const r of scored) {
    const key = `${r.section.slug}#${r.section.anchor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toHit(r.section, "prose", r.matched, r.score));
    if (out.length === n) break;
  }
  return out;
}

/**
 * The reply the page shows, built from a hit.
 *
 * Framed as a quotation on purpose: "From the docs" tells the user this is the
 * protocol's written word rather than an opinion, and the link lets them read
 * the rest. What it must never do is present the excerpt as Luca's own
 * synthesis — that is the model's job, and the difference is the whole reason
 * this net is allowed to answer without one.
 */
export function docsReply(hit: DocHit): { text: string; link: { href: string; label: string } } {
  const where = hit.heading && hit.heading !== hit.title ? `${hit.title} › ${hit.heading}` : hit.title;
  return {
    text: `From the docs — ${where}:\n\n${hit.text}`,
    link: { href: hit.href, label: "Read the full section" },
  };
}

/** Offered when there is nothing to quote, so the reply still goes somewhere. */
const DOCS_LINK = { href: "/docs", label: "Browse the docs" };

/**
 * The reply when the model was needed and could not answer.
 *
 * The old behaviour was the bare error — "the reasoning service returned an
 * error" — which is the worst reply available: it tells the user nothing about
 * their question and nothing about what to do. This says what happened and, when
 * the docs genuinely answer the question, quotes them.
 *
 * IT QUOTES ONLY A THRESHOLDED HIT, and that is the whole of this function.
 * It used to fall back to `groundingFor`, which is the wrong search for this
 * job: grounding accepts any section sharing a single term because a loose
 * passage handed silently to a model costs nothing, and the model discards it.
 * Shown to a person, prefixed "the closest thing the docs have", the same loose
 * passage is a confident non-answer. Asked to "make me a volume of $100,000" it
 * quoted the KLD supply table — matched on the digits — to a user who had asked
 * about trading volume.
 *
 * So an unmatched question now gets no quote at all. A question the docs do not
 * answer has no closest thing, and saying so is the honest reply; reaching for
 * the nearest paragraph is how a search becomes an assertion.
 */
export function outageReply(question: string): { text: string; link?: { href: string; label: string } } {
  const hit = searchDocs(question);
  if (!hit) {
    return {
      text:
        "I can't reason about that right now — the model I use for open questions is unavailable. " +
        "Direct commands like `swap 100 USDC to KLD` still run here without it, and the docs cover how everything works.",
      link: DOCS_LINK,
    };
  }
  const where = hit.heading && hit.heading !== hit.title ? `${hit.title} › ${hit.heading}` : hit.title;
  return {
    text:
      `I can't reason about that right now — the model I use for open questions is unavailable. ` +
      `The docs do answer this, though, from ${where}:\n\n${hit.text}`,
    link: { href: hit.href, label: "Read the full section" },
  };
}
