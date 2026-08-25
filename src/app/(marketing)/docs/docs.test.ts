/*
 * Checks that the docs site publishes what it means to publish, and that every
 * link on it resolves. Run with
 * `npx tsx "src/app/(marketing)/docs/docs.test.ts"`, or `npm run test:docs`.
 *
 * WHY THIS SUITE EXISTS. A docs site has two failure modes and neither one is
 * visible in a screenshot of it.
 *
 *   - DEAD LINKS. These twenty files cross-reference each other with paths
 *     written for GitHub's file browser — `./guides/README.md`,
 *     `../smart-contract/README.md`. Rendered on a web page every one of those
 *     404s unless it is rewritten, and the page around it still looks finished.
 *     `resolveDocLink` does the rewriting; section 3 walks every link in every
 *     published document and proves the rewrite lands somewhere real. One dead
 *     link already exists in the source: docs/README.md points at
 *     `../YIELD_TESTING_STATUS.md`, and the file is at
 *     `docs/guides/YIELD_TESTING_STATUS.md`. That link is broken on GitHub today.
 *
 *   - A LEAK. The manifest is an allow-list precisely so that publishing is a
 *     decision somebody makes, but `omit` weakens that at the section level: it
 *     matches heading text, and heading text gets reworded. If
 *     `## Hardcoded values that block a clean multichain deploy` is retitled, the
 *     omit silently stops matching and the section goes public, on a page that
 *     otherwise renders correctly. Section 4 asserts every `omit` string is
 *     present in its file, so a rewording fails here instead of shipping.
 *
 *     Section 5 closes the other end of it: `DOC_GROUPS` and `UNPUBLISHED`
 *     together must account for every `.md` file under `docs/`. Adding a new
 *     document to the repo then fails this suite until somebody has written down
 *     which of the two lists it belongs in — which is the only mechanism that
 *     survives the person who wrote the manifest moving on.
 *
 * The heading checks in section 6 are less dramatic and still necessary: the TOC
 * and the `id`s on the rendered headings are generated from the same `slugify`,
 * so a duplicate id means a TOC entry that scrolls to the wrong section, and a
 * heading found inside a code fence means a table-of-contents entry for a shell
 * comment.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  ALL_DOCS,
  DOC_GROUPS,
  FILE_TO_SLUG,
  REPO_BLOB,
  REPO_TREE,
  UNPUBLISHED,
  normalizeEol,
  omitSections,
  resolveDocLink,
  resolvePosix,
  scanHeadings,
  slugify,
  stripPhrases,
} from "./docs";
import { loadDoc, splitH1 } from "./docsSource";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

/* The runner is invoked from the repo root, so cwd is the root. Asserted rather
   than assumed — every read below would otherwise fail one at a time with a
   confusing ENOENT instead of once, here. */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Every `.md` under `docs/`, repo-relative with posix separators. */
function walkDocs(dir = "docs"): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walkDocs(rel));
    else if (name.endsWith(".md")) out.push(rel);
  }
  return out;
}

/**
 * Every markdown link in a document, as `[label](href)`.
 *
 * Fenced code is skipped, because these files document a CLI and a Solidity API:
 * a fence contains bracket-paren sequences that are array indexing and function
 * calls, not links, and a link checker that treats `tokens[i](x)` as a broken
 * reference reports failures nobody can fix.
 *
 * Reference-style links (`[label][ref]`) are not matched. None of the twenty
 * files uses one — section 3 asserts that separately rather than leaving it as an
 * assumption, since a reference link would slip past this scan entirely.
 */
function linksIn(md: string): string[] {
  const out: string[] = [];
  let fenced = false;

  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    /* Skip inline code spans for the same reason as fences. */
    const bare = line.replace(/`[^`]*`/g, "");
    for (const m of bare.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      out.push(m[1]);
    }
  }
  return out;
}

function main() {
  console.log("\ndocs manifest / links / omissions\n");

  check(
    "runner's cwd is the repo root",
    existsSync(join(ROOT, "package.json")) &&
      read("package.json").includes('"kaleido-agentic-os"'),
    ROOT,
  );

  /* ---------------------------------------------------------------- 1. sources */

  for (const d of ALL_DOCS) {
    check(`${d.slug}: source exists`, existsSync(join(ROOT, d.file)), d.file);
    check(
      `${d.slug}: source path is posix and under docs/`,
      d.file.startsWith("docs/") && !d.file.includes("\\"),
      d.file,
    );
  }

  /* ------------------------------------------------------------------ 2. slugs */

  const slugs = ALL_DOCS.map((d) => d.slug);
  check(
    "slugs are unique",
    new Set(slugs).size === slugs.length,
    slugs.join(","),
  );
  for (const s of slugs) {
    check(`${s}: slug is kebab-case`, /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s), s);
  }
  /* A slug that collides with the index or with a static asset would shadow it. */
  check(
    "no slug collides with the index route",
    !slugs.includes("docs"),
    slugs.join(","),
  );

  const files = ALL_DOCS.map((d) => d.file);
  check(
    "no source file is published twice",
    new Set(files).size === files.length,
    files.join(","),
  );

  for (const d of ALL_DOCS) {
    check(`${d.slug}: has a blurb`, d.blurb.trim().length > 20, `"${d.blurb}"`);
    check(`${d.slug}: has a title`, d.title.trim().length > 0, d.title);
  }

  check(
    "every group has at least one entry",
    DOC_GROUPS.every((g) => g.entries.length > 0),
  );

  /* ------------------------------------------------------------------ 3. links */

  const allFiles = walkDocs();
  const onDisk = new Set(allFiles);

  for (const d of ALL_DOCS) {
    const src = read(d.file);

    check(
      `${d.slug}: no reference-style links (the scan would miss them)`,
      !/^\s*\[[^\]]+\]:\s+\S+/m.test(src),
      "found a link reference definition",
    );

    for (const href of linksIn(src)) {
      const { href: out, external } = resolveDocLink(href, d.file);

      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
        check(
          `${d.slug}: external "${href}" opens in a new tab`,
          external && out === href,
        );
        continue;
      }

      if (href.startsWith("#")) {
        /* An in-page link has to name a heading that survived the omissions. */
        const loaded = loadDoc(d.slug)!;
        const ids = new Set(loaded.headings.map((h) => h.id));
        check(
          `${d.slug}: fragment "${href}" names a heading on the page`,
          ids.has(href.slice(1)),
          [...ids].join(","),
        );
        continue;
      }

      /* Relative. It must resolve to a file (or directory) that exists. */
      const path = href.split("#")[0];
      const base = d.file.slice(0, d.file.lastIndexOf("/"));
      const target = resolvePosix(base, path);

      const exists =
        onDisk.has(target) ||
        existsSync(join(ROOT, target.split("/").join("/")));

      check(
        `${d.slug}: "${href}" resolves to something real`,
        exists,
        `-> ${target}`,
      );

      if (FILE_TO_SLUG[target]) {
        check(
          `${d.slug}: "${href}" becomes an in-site link`,
          !external && out.startsWith(`/docs/${FILE_TO_SLUG[target]}`),
          out,
        );
      } else if (exists) {
        check(
          `${d.slug}: "${href}" falls back to the repository`,
          external && (out.startsWith(REPO_BLOB) || out.startsWith(REPO_TREE)),
          out,
        );
      }
    }
  }

  /* No published page may still contain a `.md` link after rendering — that is
     the assertion the served HTML is grepped for, restated here so it fails
     before a deploy rather than after one. */
  for (const d of ALL_DOCS) {
    const rewritten = linksIn(read(d.file)).map(
      (h) => resolveDocLink(h, d.file).href,
    );
    const stillRelative = rewritten.filter(
      (h) => !h.startsWith("/") && !h.startsWith("#") && !/^[a-z]+:/i.test(h),
    );
    check(
      `${d.slug}: every link is absolute after rewriting`,
      stillRelative.length === 0,
      stillRelative.join(","),
    );
  }

  /* -------------------------------------------------------------- 4. omissions */

  for (const d of ALL_DOCS) {
    const src = read(d.file);

    if (d.omit) {
      const lines = normalizeEol(src)
        .split("\n")
        .map((l) => l.trim());

      for (const heading of d.omit) {
        check(
          `${d.slug}: omit "${heading}" is present in the source`,
          lines.includes(heading.trim()),
          "heading reworded or removed — the section would now be published",
        );
      }
    }

    if (d.strip) {
      for (const phrase of d.strip) {
        check(
          `${d.slug}: strip phrase is present in the source`,
          normalizeEol(src).includes(normalizeEol(phrase)),
          `"${phrase.slice(0, 60)}…" no longer matches`,
        );
      }
    }

    if (!d.omit && !d.strip) continue;

    /* And it is actually gone from what gets rendered. Checking the mechanism as
       well as the target, because a present heading and a working omit are two
       different facts — and the first version of this feature had the second one
       broken while the first one passed. */
    const published = stripPhrases(
      omitSections(src, d.omit ?? []),
      d.strip ?? [],
    );

    for (const heading of d.omit ?? []) {
      const text = heading.replace(/^#+\s*/, "").trim();
      check(
        `${d.slug}: "${text}" is absent from the published text`,
        !published.includes(text),
      );
    }
    for (const phrase of d.strip ?? []) {
      check(
        `${d.slug}: stripped phrase is absent from the published text`,
        !published.includes(normalizeEol(phrase)),
      );
    }

    /* Nothing may still point at a section that was removed. This is the failure
       the reader sees rather than the one that leaks: a page that says "see X
       below" with no X below. Matched on the distinctive words of each omitted
       heading, because prose refers to a section by its name and not by its full
       title — the live case is `see "Known drift" below`, which contains none of
       "why the registry exists". */
    for (const heading of d.omit ?? []) {
      const words = heading
        .replace(/^#+\s*/, "")
        .replace(/\([^)]*\)/g, "")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .join(" ");
      check(
        `${d.slug}: nothing left refers to "${words}"`,
        !published.includes(words),
        "a dangling cross-reference to an omitted section",
      );
    }

    check(
      `${d.slug}: omitting left content behind`,
      published.trim().length > 400,
      `${published.trim().length} chars remain`,
    );
  }

  /* ------------------------------------------------- 5. every file is accounted for */

  const decided = new Set([
    ...Object.keys(FILE_TO_SLUG),
    ...Object.keys(UNPUBLISHED),
  ]);
  for (const f of allFiles) {
    check(
      `${f}: published or explicitly held back`,
      decided.has(f),
      "add it to DOC_GROUPS or to UNPUBLISHED with a reason",
    );
  }
  for (const f of Object.keys(UNPUBLISHED)) {
    check(`UNPUBLISHED names a real file: ${f}`, onDisk.has(f));
    check(
      `${f}: not in both lists`,
      !FILE_TO_SLUG[f],
      "held back and published at once",
    );
    check(
      `${f}: the reason is written out`,
      UNPUBLISHED[f].trim().length > 15,
      UNPUBLISHED[f],
    );
  }

  /* The five files this feature exists to keep off the internet. Named
     individually rather than by folder, so deleting the folder check by accident
     is not the same as deleting the guarantee. */
  for (const f of [
    "docs/security/SECURITY_FINDINGS.md",
    "docs/security/SECURITY_AUDIT.md",
    "docs/security/SECURITY_AUDIT_COMPLETE.md",
    "docs/security/SECURITY_TESTING.md",
    "docs/security/SECURITY_TESTING_STATUS.md",
    "docs/interface-inventory.md",
  ]) {
    check(`${f} is not published`, !FILE_TO_SLUG[f]);
  }

  /* ---------------------------------------------------------------- 6. headings */

  for (const d of ALL_DOCS) {
    const loaded = loadDoc(d.slug);
    check(`${d.slug}: loads`, loaded !== null);
    if (!loaded) continue;

    const ids = loaded.headings.map((h) => h.id);
    check(
      `${d.slug}: heading ids are unique`,
      new Set(ids).size === ids.length,
      ids.join(","),
    );
    check(
      `${d.slug}: every heading id is a usable anchor`,
      ids.every((i) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(i)),
      ids.filter((i) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(i)).join(","),
    );
    check(
      `${d.slug}: has headings to build a TOC from`,
      ids.length >= 2,
      `${ids.length}`,
    );
    check(
      `${d.slug}: has an H1`,
      loaded.h1.trim().length > 0 && loaded.h1 !== d.title,
      `h1="${loaded.h1}" title="${d.title}"`,
    );
    check(
      `${d.slug}: the H1 is not repeated in the body`,
      !loaded.markdown.startsWith("# "),
    );

    /* No heading may have come out of a code fence. Checked by looking for the
       two things fences in this content actually contain. */
    const suspect = loaded.headings.filter((h) =>
      /^(npx|npm|cd |install|deploy the|--|\/\/)/i.test(h.text),
    );
    check(
      `${d.slug}: no TOC entry looks like a shell comment`,
      suspect.length === 0,
      suspect.map((h) => h.text).join(" | "),
    );
  }

  /* ------------------------------------------------------------ 7. pure helpers */

  check(
    "slugify: strips inline code",
    slugify("`kfUSD` mint") === "kfusd-mint",
  );
  check(
    "slugify: collapses punctuation and em dashes",
    slugify("3a. Time-weighted — passive capital") ===
      "3a-time-weighted-passive-capital",
  );
  check("slugify: drops emoji", slugify("⚠️ Pending") === "pending");
  check(
    "slugify: keeps a link's label",
    slugify("[Deploy](x.md) it") === "deploy-it",
  );
  check("slugify: trims separators", slugify("## Overview ##") === "overview");

  check(
    "resolvePosix: ./",
    resolvePosix("docs/guides", "./README.md") === "docs/guides/README.md",
  );
  check(
    "resolvePosix: ../",
    resolvePosix("docs/guides", "../README.md") === "docs/README.md",
  );
  check(
    "resolvePosix: ../../ out of docs",
    resolvePosix("docs/guides", "../../smart-contract/README.md") ===
      "smart-contract/README.md",
  );

  check(
    "resolveDocLink: fragment survives the rewrite",
    resolveDocLink(
      "./COLLATERAL_TO_POOLS_FLOW.md#summary",
      "docs/guides/README.md",
    ).href === "/docs/collateral-flow#summary",
  );
  check(
    "resolveDocLink: a bare directory goes to the tree view",
    resolveDocLink("./security/", "docs/README.md").href ===
      `${REPO_TREE}/docs/security`,
  );
  check(
    "resolveDocLink: javascript: is left for the sanitizer, not laundered",
    resolveDocLink("javascript:alert(1)", "docs/README.md").href ===
      "javascript:alert(1)",
  );

  check(
    "omitSections: takes the heading's children with it",
    omitSections("## A\n\ntext\n\n### A1\n\nmore\n\n## B\n\nkeep\n", [
      "## A",
    ]).trim() === "## B\n\nkeep",
  );
  check(
    "omitSections: leaves siblings of an omitted H3 alone",
    omitSections("## A\n\n### A1\n\nx\n\n### A2\n\ny\n", ["### A1"]).includes(
      "### A2",
    ),
  );
  check(
    "omitSections: a `##` inside a fence is not a section boundary",
    omitSections("## A\n\n```sh\n## not a heading\n```\n\n## B\n\nkeep\n", [
      "## A",
    ]).trim() === "## B\n\nkeep",
  );
  check(
    "omitSections: the rule before a removed section goes too",
    !omitSections("## A\n\nx\n\n---\n\n## B\n\ny\n", ["## B"]).includes("---"),
  );
  check(
    "omitSections: an unmatched heading changes nothing",
    omitSections("## A\n\nx\n", ["## Z"]) === "## A\n\nx\n",
  );

  /* CRLF. THE REGRESSION THIS SUITE ACTUALLY CAUGHT, so it gets explicit cases
     rather than relying on the four real documents to keep being CRLF.

     All four published files are CRLF on every line. `.` does not match CR in a
     JavaScript regex, so a heading pattern ending `.+$` matches nothing in them —
     which made omitSections a silent no-op and published all four internal
     sections while every other assertion passed. */
  check(
    "omitSections: works on CRLF input",
    omitSections("## A\r\n\r\nx\r\n\r\n## B\r\n\r\nkeep\r\n", [
      "## A",
    ]).trim() === "## B\n\nkeep",
  );
  check(
    "scanHeadings: works on CRLF input",
    scanHeadings("## One\r\n\r\ntext\r\n\r\n### Two\r\n").length === 2,
  );
  check(
    "splitH1: works on CRLF input",
    splitH1(normalizeEol("# Title\r\n\r\nBody\r\n")).h1 === "Title",
  );
  check(
    "normalizeEol: collapses CRLF and a lone CR",
    normalizeEol("a\r\nb\rc\nd") === "a\nb\nc\nd",
  );
  /* And the documents really are CRLF, so the cases above are not hypothetical. */
  check(
    "the published sources are still CRLF (the reason normalizeEol exists)",
    ALL_DOCS.some((d) => read(d.file).includes("\r\n")),
  );

  check(
    "stripPhrases: removes a phrase spanning a line break",
    stripPhrases("keep this (see\nX below) end", [" (see\nX below)"]) ===
      "keep this end",
  );
  check(
    "stripPhrases: matches a manifest \\n against CRLF source",
    stripPhrases("a (see\r\nX) b", [" (see\nX)"]) === "a b",
  );
  check(
    "stripPhrases: treats the phrase as a literal, not a pattern",
    stripPhrases("a (b.c?) d", [" (b.c?)"]) === "a d",
  );

  check(
    "scanHeadings: skips fenced code",
    scanHeadings("## Real\n\n```bash\n# install deps\n## also not\n```\n")
      .length === 1,
  );
  check(
    "scanHeadings: suffixes duplicate ids",
    scanHeadings("## Overview\n\n## Overview\n")
      .map((h) => h.id)
      .join(",") === "overview,overview-1",
  );
  check(
    "scanHeadings: ignores H1 and H4",
    scanHeadings("# A\n\n#### D\n").length === 0,
  );

  check(
    "splitH1: lifts the title and the rule under it",
    splitH1("# Title\n\n---\n\nBody\n").body.trim() === "Body",
  );
  check(
    "splitH1: reports the title",
    splitH1("# Title\n\nBody\n").h1 === "Title",
  );
  check(
    "splitH1: leaves a document with no leading H1 alone",
    splitH1("Intro\n\n# Later\n").h1 === null,
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
