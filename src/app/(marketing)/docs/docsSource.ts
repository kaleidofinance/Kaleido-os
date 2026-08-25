import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_DOCS,
  docBySlug,
  normalizeEol,
  omitSections,
  scanHeadings,
  stripPhrases,
  type DocEntry,
  type Heading,
} from "./docs";

/**
 * Reading `docs/` off disk. The half of the docs feature that touches the
 * filesystem, kept apart from `docs.ts` so the sidebar can import the manifest.
 *
 * ---------------------------------------------------------------------------
 * WHY `readFileSync` IS FINE HERE
 * ---------------------------------------------------------------------------
 * Every caller is a server component reached through `generateStaticParams`, so
 * these reads happen once per page at build time and never in response to a
 * request. There is no request to block and no cache to warm — the output is
 * HTML in `.next`. That also answers the question this pattern usually raises:
 * `docs/` sits outside `src/`, which would be a file-tracing problem if a running
 * server had to find it, and is not one when nothing at runtime opens it.
 *
 * The read is deliberately unguarded. A missing file throws during `next build`
 * and the build fails with the path in the message, which is the correct outcome
 * for a manifest that names a file that is not there — a `try`/`catch` returning
 * empty content would ship a blank page that looks like a styling bug.
 * `docs.test.ts` checks the same thing earlier and more cheaply.
 */

/**
 * The repository root.
 *
 * `process.cwd()` is the project directory for `next dev`, `next build` and the
 * test scripts alike, all of which run from the package root. `join` (not the
 * posix resolver in docs.ts) because this one produces a real path for the OS
 * underneath — the manifest's forward slashes have to become backslashes on
 * Windows, which is where this is being developed.
 */
const ROOT = process.cwd();

export interface LoadedDoc {
  entry: DocEntry;
  /** Markdown with omitted sections already removed. */
  markdown: string;
  /** H2s and H3s of the *published* text, so an omitted section is not listed. */
  headings: Heading[];
  /** The document's own H1, or the manifest title if it has none. */
  h1: string;
}

/**
 * One document, ready to render.
 *
 * Order matters and is not interchangeable: sections come out *before* the
 * headings are scanned, so the table of contents describes the page as published
 * rather than the file as written. Scanning first would list an omitted section
 * in the TOC and give the reader a link that scrolls nowhere — the leak would be
 * the heading text itself, which in these files is the part that says the thing
 * ("Hardcoded values that block a clean multichain deploy").
 *
 * `stripPhrases` runs after `omitSections` for the same reason in miniature: the
 * phrases it removes are references *to* omitted sections, so removing the
 * sections first keeps the two steps in the order a reader would reason about
 * them.
 *
 * The H1 is lifted out of the markdown and returned separately so the page can
 * render it as its own title element beside the metadata line. `splitH1` then
 * removes it from the body, because a document whose first block is an H1 inside
 * the prose puts two titles on the page.
 */
export function loadDoc(slug: string): LoadedDoc | null {
  const entry = docBySlug(slug);
  if (!entry) return null;

  const raw = normalizeEol(readFileSync(join(ROOT, entry.file), "utf8"));
  const trimmed = stripPhrases(
    omitSections(raw, entry.omit ?? []),
    entry.strip ?? [],
  );
  const { h1, body } = splitH1(trimmed);

  return {
    entry,
    markdown: body,
    headings: scanHeadings(body),
    h1: h1 ?? entry.title,
  };
}

export function loadAllDocs(): LoadedDoc[] {
  return ALL_DOCS.map((d) => loadDoc(d.slug)).filter(
    (d): d is LoadedDoc => d !== null,
  );
}

/**
 * Take the first H1 off the top of the document.
 *
 * Only the *leading* H1, which is why the scan stops at the first line that is
 * neither blank nor a level-one heading. A `#` further down the file is a section
 * its author chose to set at that level, and hoisting it out of the middle of a
 * document into the page title would reorder the content. No fence tracking is
 * needed for the same reason — a fence is content, so the scan has already
 * stopped by the time one could matter.
 */
export function splitH1(md: string): { h1: string | null; body: string } {
  const lines = md.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;

    const m = /^#\s+(.+?)\s*$/.exec(lines[i]);
    if (!m) break;

    const rest = lines.slice(i + 1);
    /* Drop the blank lines and any rule that separated the title from the body. */
    while (rest.length > 0 && rest[0].trim() === "") rest.shift();
    if (rest.length > 0 && /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(rest[0])) {
      rest.shift();
      while (rest.length > 0 && rest[0].trim() === "") rest.shift();
    }
    return { h1: m[1].trim(), body: rest.join("\n") };
  }

  return { h1: null, body: md };
}
