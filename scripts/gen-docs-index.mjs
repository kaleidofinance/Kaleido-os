/**
 * Build the local docs index Luca answers from.
 *
 *   npm run gen:docs
 *
 * WHAT THIS IS FOR. The agent's two local nets are a command grammar and a
 * hand-written FAQ of ~20 topics matched by substring. Anything phrased outside
 * those triggers reaches the cloud model — which costs a credit per question and,
 * when the account has no credits, answers "the reasoning service returned an
 * error" to a person who asked how fees work. The docs already answer most of
 * those questions, precisely and in the protocol's own words. This index lets
 * the page look them up locally and CITE the passage, with a link to the section
 * it came from, instead of paying a model to paraphrase it.
 *
 * ONE SOURCE OF TRUTH FOR WHAT IS PUBLIC. Sections are cut from the same
 * `loadDoc()` the docs site renders from, so anything the manifest omits or
 * strips is never indexed — the allow-list in docs.ts applies here by
 * construction, not by a second list someone has to keep in step. Anchors come
 * from the same `scanHeadings()` too, so a link from the agent lands on the
 * exact heading the site draws.
 *
 * COMMITTED, NOT BUILT. `build` is bare `next build`, like the address registry
 * this mirrors: the output is checked in, and docsSearch.test.ts fails if it has
 * drifted from the docs. A stale index would not break the app, it would make
 * Luca quote a paragraph the docs no longer say — which is worse.
 *
 * The text is markdown reduced to prose. Tables become "cell — cell" lines so a
 * fee row is still a sentence; images and links keep their words and lose their
 * targets; code spans keep their content. Nothing is rewritten.
 */
import fs from "node:fs";
import path from "node:path";
import { ALL_DOCS, scanHeadings, stripInline } from "../src/app/(marketing)/docs/docs.ts";
import { loadDoc } from "../src/app/(marketing)/docs/docsSource.ts";

import { tokenize } from "../src/lib/ai/docsTokens.ts";

const OUT = process.env.OUT ?? path.join("src", "lib", "ai", "docsIndex.generated.ts");

/* Markdown to prose, section by section. */
function toProse(md) {
  const out = [];
  let fenced = false;
  for (const raw of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    let line = raw.trim();
    if (!line) {
      out.push("");
      continue;
    }
    if (/^!\[/.test(line)) continue; // an image: the caption is not prose
    if (/^\|?\s*-{3,}/.test(line) && /^[|\s:-]+$/.test(line)) continue; // table rule
    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .map((c) => stripInline(c).trim())
        .filter(Boolean);
      if (cells.length) out.push(cells.join(" — "));
      continue;
    }
    line = line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "");
    out.push(stripInline(line));
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sections(doc) {
  const lines = doc.markdown.split("\n");
  const heads = scanHeadings(doc.markdown);
  const result = [];

  /* Everything before the first H2 is the page's lead — the paragraph that says
     what the page is about — and it is the best answer to "what is X". */
  let cursor = 0;
  let hi = 0;
  const isHeading = (l) => /^#{2,3}\s+/.test(l);
  const firstHead = lines.findIndex(isHeading);
  const leadEnd = firstHead === -1 ? lines.length : firstHead;
  const lead = toProse(lines.slice(0, leadEnd).join("\n"));
  if (lead) result.push({ heading: doc.h1, anchor: "", text: lead });

  cursor = leadEnd;
  while (cursor < lines.length) {
    if (!isHeading(lines[cursor])) {
      cursor++;
      continue;
    }
    const start = cursor + 1;
    let end = start;
    while (end < lines.length && !isHeading(lines[end])) end++;
    const h = heads[hi++];
    const text = toProse(lines.slice(start, end).join("\n"));
    if (h && text) result.push({ heading: h.text, anchor: h.id, text });
    cursor = end;
  }
  return result;
}

const entries = [];
for (const entry of ALL_DOCS) {
  const doc = loadDoc(entry.slug);
  if (!doc) throw new Error(`docs index: ${entry.slug} did not load`);
  for (const s of sections(doc)) {
    entries.push({
      slug: entry.slug,
      title: entry.title,
      heading: s.heading,
      anchor: s.anchor,
      text: s.text,
      /* Three fields, kept apart. A page title and a section heading are the
         author's own statement of what the text is about, and a word there is
         worth more than the same word in a passing mention in the body. Folding
         them into one bag is what made "how does staking work" land on an
         overview table that merely lists staking. */
      titleTerms: tokenize(entry.title),
      headTerms: tokenize(s.heading),
      bodyTerms: tokenize(s.text),
    });
  }
}

const df = new Map();
for (const e of entries) for (const t of new Set([...e.titleTerms, ...e.headTerms, ...e.bodyTerms])) df.set(t, (df.get(t) ?? 0) + 1);
const avgLen = entries.reduce((a, e) => a + e.bodyTerms.length, 0) / entries.length;

const header = `/* GENERATED by scripts/gen-docs-index.mjs — do not edit.
 * Run \`npm run gen:docs\` after changing anything under docs/product/.
 * docsSearch.test.ts fails when this file is behind the docs. */

export interface DocSection {
  slug: string;
  title: string;
  heading: string;
  /** Empty for a page's lead paragraph, which has no heading of its own. */
  anchor: string;
  text: string;
  titleTerms: string[];
  headTerms: string[];
  bodyTerms: string[];
}

export const DOC_INDEX_STATS = ${JSON.stringify({ sections: entries.length, avgLen: Number(avgLen.toFixed(2)) })} as const;

export const DOC_DF: Record<string, number> = ${JSON.stringify(Object.fromEntries(df))};

export const DOC_INDEX: DocSection[] = `;

fs.writeFileSync(OUT, header + JSON.stringify(entries, null, 2) + ";\n");
console.log(`Wrote ${OUT}: ${entries.length} sections from ${ALL_DOCS.length} docs, ${df.size} distinct terms.`);
