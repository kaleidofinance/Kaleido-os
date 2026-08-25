/*
 * Checks that the product rail's art is actually drawn from the sources it claims.
 * Run with `npx tsx "src/app/(marketing)/_components/products.test.ts"`, or
 * `npm run test:products`.
 *
 * WHY THIS SUITE EXISTS. `ProductArt` is the one part of the landing page that
 * draws pictures, and every failure mode it has is silent:
 *
 *   - A token symbol that TokenIcon cannot resolve renders `fallback`, and this
 *     caller passes none. So a typo, a renamed asset, or a deleted PNG produces a
 *     figure with a hole in it and no error anywhere. Types cannot catch it: the
 *     prop is `string`.
 *   - The rail's row icons are hand-drawn paths, shared with Nav's mobile tab bar
 *     via components/v2/SectionIcon.tsx. A stroke that is not `currentColor`
 *     renders correctly in whichever theme it was authored in and wrong in the
 *     other; an entry left with no geometry renders an empty square. The five
 *     marketing `ArtKind`s and the seven shared `SectionIconKind`s are written out
 *     twice — app chrome must not import from a marketing route group — so nothing
 *     but a test proves the five are still among the seven. Section 1.
 *   - The three fee-tier labels are RESTATED from /pool/new rather than imported,
 *     because that module is `"use client"` with the whole wallet stack above it.
 *     A restated constant is a constant that can drift, and the drift would be a
 *     landing page confidently advertising a tier the pool UI does not offer.
 *   - The borrow and lend figures are the `example` objects in capabilities.ts,
 *     which the section directly above types into its composer. Two different sets
 *     of numbers for the same fixture, one section apart, is worse than one set.
 *   - `ProductArt` must stay free of hooks, fetches and the wallet. The route
 *     group's layout.tsx is explicit that the landing page has exactly one state,
 *     and an import is all it takes to give it two.
 *   - The panel's footer links are strings. A `href` to a route that no longer
 *     exists type-checks, builds and renders, and 404s only when pressed — and
 *     their labels restate the app's own tab words, which is the fee-tier drift
 *     problem again. Section 9.
 *
 * HOW THE TOKEN CHECK WORKS, and why it is not simply `hasTokenIcon`. That would be
 * the obvious thing to call, but `TokenIcon.tsx` imports `./TokenIcon.module.css`
 * and tsx cannot resolve a CSS module, so the function is unreachable from a plain
 * node runner. Instead this file parses the three tables — ICONS, ALIASES, RASTER —
 * out of that source and mirrors the resolution `hasTokenIcon` performs. That is a
 * weaker guarantee about the *function* and an equally strong one about the *data*,
 * which is what actually breaks: the tables are where a symbol goes missing. The
 * mirror is asserted to have found all three tables before anything relies on it,
 * so a parse that silently matches nothing fails as a parse error rather than as
 * twelve unrelated symbol failures.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PRODUCTS, type ArtKind } from "./products";
import { GROUPS } from "./capabilities";
import { TICK_SPACINGS } from "../../../constants/utils/v3Math";

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
   than assumed — every file read below would otherwise fail one at a time with a
   confusing ENOENT instead of once, here. */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const MARKETING = "src/app/(marketing)/_components";

function main() {
  console.log("\nproducts / ProductArt\n");

  check(
    "runner's cwd is the repo root",
    existsSync(join(ROOT, "package.json")) &&
      read("package.json").includes('"kaleido-agentic-os"'),
    ROOT,
  );

  const artSrc = read(`${MARKETING}/ProductArt.tsx`);
  const artCss = read(`${MARKETING}/ProductArt.module.css`);
  const railSrc = read(`${MARKETING}/ProductRail.tsx`);
  const railCss = read(`${MARKETING}/ProductRail.module.css`);
  const iconSrc = read("src/components/v2/TokenIcon.tsx");
  const poolSrc = read("src/app/(app)/pool/new/page.tsx");

  /* Comments stripped, and the code-level checks below run on THIS rather than on
     the raw file. The components in this route group carry long docblocks that
     quote the very things being searched for — ProductArt.tsx's own prose contains
     `"use client"` (explaining why /pool/new is one), `from "a risk slider over
     someone else's range"` (quoting a product fact), and the percentages `19%` and
     `0.01%` (the deleted price chart, and the fee tier deliberately left out). The
     first draft of this suite matched all four and reported four failures in a file
     that had none of the problems. Block comments first so `//` inside one is gone
     before the line-comment pass; no string literal here contains `//`, and if one
     ever does this is where it breaks. */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const artCode = stripComments(artSrc);

  /* ------------------------------------------------------------------
   * The TokenIcon mirror.
   * ------------------------------------------------------------------ */

  /** The body of a `const NAME … = { … };` object literal, as text. */
  const objectBody = (src: string, name: string): string => {
    const m = src.match(
      new RegExp(`const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`),
    );
    return m ? m[1] : "";
  };
  /** The body of a `const NAME … = [ … ];` array literal, `as const` or not. */
  const arrayBody = (src: string, name: string): string => {
    const m = src.match(
      new RegExp(
        `const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\](?:\\s*as const)?;`,
      ),
    );
    return m ? m[1] : "";
  };
  const keysOf = (body: string): string[] =>
    [...body.matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
  const pairsOf = (body: string): Record<string, string> =>
    Object.fromEntries(
      [...body.matchAll(/^\s*([A-Za-z0-9_]+):\s*"([^"]+)"/gm)].map((m) => [
        m[1],
        m[2],
      ]),
    );

  const icons = new Set(keysOf(objectBody(iconSrc, "ICONS")));
  const aliases = pairsOf(objectBody(iconSrc, "ALIASES"));
  const raster = pairsOf(objectBody(iconSrc, "RASTER"));

  /* Before anything trusts the mirror. If a table's shape changes and the regex
     stops matching, every symbol check below would fail for the wrong reason. */
  check(
    "TokenIcon's ICONS table parsed",
    icons.size >= 10,
    `${icons.size} keys`,
  );
  check(
    "TokenIcon's ALIASES table parsed",
    Object.keys(aliases).length >= 7,
    JSON.stringify(aliases),
  );
  check(
    "TokenIcon's RASTER table parsed",
    Object.keys(raster).length >= 3,
    JSON.stringify(raster),
  );

  /** Mirrors hasTokenIcon: uppercase, follow one alias hop, then either table. */
  const resolve = (
    symbol: string,
  ): { kind: "vector" | "raster"; key: string; src?: string } | null => {
    const key = symbol.trim().toUpperCase();
    const r = aliases[key] ?? key;
    if (icons.has(r)) return { kind: "vector", key: r };
    if (raster[r]) return { kind: "raster", key: r, src: raster[r] };
    return null;
  };

  /** Resolves, and for a raster asset also proves the file is on disk. */
  const drawable = (symbol: string): string | null => {
    const hit = resolve(symbol);
    if (!hit) return "no ICONS, ALIASES or RASTER entry";
    if (hit.kind === "raster") {
      const file = join(ROOT, "public", hit.src as string);
      if (!existsSync(file)) return `RASTER path missing on disk: ${hit.src}`;
    }
    return null;
  };

  /* ------------------------------------------------------------------
   * 1. Every rail row draws an icon, and every icon inherits its colour.
   *
   * This slot held `p.mark` — the product's token symbols, resolved through the
   * mirror above. It holds <SectionIcon> now, which moves the failure mode rather
   * than removing it.
   *
   * SECTIONICON IS NOT IN THIS ROUTE GROUP. It lives at components/v2 because Nav's
   * mobile tab bar draws the same set, and its checks are here anyway because this
   * is the suite that already knows what the five products are. What that buys is
   * the subset assertion below: the marketing `ArtKind` union and the shared
   * `SectionIconKind` union are written out twice on purpose — app chrome must not
   * import from a marketing route group — so something has to prove the five are
   * still in the seven.
   *
   * TypeScript covers what it can: both dispatch tables are `Record`s over their
   * union, so a new member cannot ship without a drawing. What it cannot see is
   * inside the path data, and there are two silent ways to get that wrong:
   *
   *   - A `fill` other than none, or a stroke that is not `currentColor`. Both
   *     callers tint these from CSS — muted then brand green in the rail, --k-t2
   *     then --k-brand in the tab bar — and both ends invert between light and
   *     dark. A literal colour looks correct in whichever theme it was authored in
   *     and wrong in the other, with nothing to report it.
   *   - An empty or near-empty icon. A <path> with no `d`, or a shape left behind
   *     after an edit, renders a blank 20px square.
   * ------------------------------------------------------------------ */
  const secIconSrc = read("src/components/v2/SectionIcon.tsx");
  const secIconCode = stripComments(secIconSrc);

  check(
    "SectionIcon's dispatch table is a Record over SectionIconKind",
    /const PATHS: Record<SectionIconKind,/.test(secIconCode),
    "PATHS is not typed as Record<SectionIconKind, …>",
  );
  check(
    "SectionIcon strokes with currentColor",
    secIconCode.includes('stroke="currentColor"'),
    "",
  );
  check(
    "SectionIcon hardcodes no colour",
    !/#[0-9a-fA-F]{3,8}\b/.test(secIconCode) &&
      !/\b(rgb|rgba|hsl|hsla)\(/.test(secIconCode),
    secIconCode.match(/#[0-9a-fA-F]{3,8}\b|\b(rgb|hsl)a?\(/)?.[0] ?? "",
  );

  /** The keys of the shared union, parsed from its `Record<…>` dispatch table. */
  const iconKeys = [
    ...secIconCode
      .slice(secIconCode.indexOf("const PATHS"))
      .matchAll(/^ {2}([a-z]+): /gm),
  ].map((m) => m[1]);
  check(
    "parsed SectionIcon's keys",
    iconKeys.length === 7,
    iconKeys.join(",") || "none",
  );
  check(
    "every ArtKind is a SectionIcon key",
    PRODUCTS.every((p) => iconKeys.includes(p.art)),
    PRODUCTS.map((p) => p.art)
      .filter((k) => !iconKeys.includes(k))
      .join(",") || "",
  );

  /* Geometry per key. Counted as elements plus `M` subpath commands rather than as
     <path> tags, because `leaderboard` is three bars in one path and splitting it
     in two to satisfy a count would be the test writing the code. A key present
     with an empty body is the failure this catches, so counting keys would not do
     it.

     `M\d` with nothing in front of it. The first draft required a space or a quote
     before the M and undercounted every compressed subpath: SVG lets a command
     follow the previous one's last coordinate with no separator, so
     `M6 20V14M12 20V6M18 20V11` is three subpaths that read as one match. That is
     the exact icon the comment above is about, and it failed at 1 shape. There is
     nothing to disambiguate against — a capital M before a digit is a moveto and
     these bodies hold path data and JSX tags, nothing else. */
  for (const kind of iconKeys) {
    const at = secIconCode.indexOf(`${kind}: `);
    const body = secIconCode.slice(at, at + 400).split(/\n {2}\/?[a-z}]/)[0];
    const shapes =
      [...body.matchAll(/<rect |<circle /g)].length +
      [...body.matchAll(/M\d/g)].length;
    check(
      `SectionIcon draws something for ${kind}`,
      at >= 0 && shapes >= 2,
      at < 0 ? "key missing" : `${shapes} shapes`,
    );
  }

  check(
    "no product carries a token `mark` any more",
    !/\bmark:/.test(stripComments(read(`${MARKETING}/products.ts`))),
    "products.ts still has a mark field",
  );
  check(
    "the rail no longer draws TokenIcon",
    !stripComments(railSrc).includes("TokenIcon"),
    "ProductRail still imports or renders TokenIcon",
  );

  /* The other caller. Nav's tab bar held Unicode glyphs, and a glyph is whatever
     the device's font stack has coverage for — `◍` and `◈` are the two that come
     back as a tofu box. Asserted here because this suite already owns SectionIcon's
     guarantees, and because a `LINKS` entry that quietly goes back to a character
     would compile: it is only a type error while `icon` is annotated
     `SectionIconKind`, which is the second half of this check. */
  const navCode = stripComments(read("src/components/v2/Nav.tsx"));
  check(
    "Nav's tab bar draws SectionIcon",
    navCode.includes("<SectionIcon kind={l.icon}"),
    "",
  );
  check(
    "Nav's LINKS type their icon as SectionIconKind",
    /icon:\s*SectionIconKind/.test(navCode),
    "icon is untyped, so a bad key would render a blank square",
  );
  const navIcons = [...navCode.matchAll(/icon:\s*"([^"]+)"/g)].map((m) => m[1]);
  check(
    "parsed Nav's seven icon keys",
    navIcons.length === 7,
    navIcons.join(",") || "none",
  );
  check(
    "every icon Nav names is a SectionIcon key",
    navIcons.every((k) => iconKeys.includes(k)),
    navIcons.filter((k) => !iconKeys.includes(k)).join(",") || "",
  );
  check(
    "every SectionIcon key is used by Nav",
    iconKeys.every((k) => navIcons.includes(k)),
    `unused: ${iconKeys.filter((k) => !navIcons.includes(k)).join(",") || "none"}`,
  );

  /* ------------------------------------------------------------------
   * 2. Every product has its own figure.
   *
   * Five products and five ArtKinds, so distinctness is the real assertion: a
   * duplicate means one figure is drawn twice and another is dead code that
   * TypeScript will not flag, because the union stays satisfied.
   * ------------------------------------------------------------------ */
  const KINDS: ArtKind[] = ["swap", "range", "book", "wrap", "mint"];
  const used = PRODUCTS.map((p) => p.art);
  check(
    "every product's art is a known ArtKind",
    used.every((k) => KINDS.includes(k)),
    used.join(","),
  );
  check(
    "no two products share a figure",
    new Set(used).size === used.length,
    used.join(","),
  );
  check(
    "every figure ProductArt defines is used by a product",
    KINDS.every((k) => used.includes(k)),
    `unused: ${KINDS.filter((k) => !used.includes(k)).join(",") || "none"}`,
  );
  /* The dispatch table is a Record over the union, so TypeScript already requires
     all five keys — but only if the table is still typed that way. Checked in
     source so that loosening it to a plain object is caught here. */
  check(
    "ProductArt's dispatch table is a Record over ArtKind",
    /const FIGURES: Record<ArtKind,/.test(artCode),
    "FIGURES is not typed as Record<ArtKind, …>",
  );

  /* ------------------------------------------------------------------
   * 3. Every token inside a figure draws something.
   *
   * Both call shapes: `<TokenIcon symbol="X"` and `<Stack symbols={["A","B"]}`.
   * ------------------------------------------------------------------ */
  const figureSymbols = new Set<string>();
  for (const m of artCode.matchAll(/symbol="([^"]+)"/g))
    figureSymbols.add(m[1]);
  for (const m of artCode.matchAll(/symbols=\{\[([^\]]+)\]\}/g)) {
    for (const q of m[1].matchAll(/"([^"]+)"/g)) figureSymbols.add(q[1]);
  }
  check(
    "found the figures' token symbols in source",
    figureSymbols.size >= 7,
    [...figureSymbols].join(","),
  );
  for (const sym of [...figureSymbols].sort()) {
    check(
      `figure token ${sym} resolves to real art`,
      drawable(sym) === null,
      drawable(sym) ?? "",
    );
  }

  /* ------------------------------------------------------------------
   * 4. The fee tiers have not drifted from /pool/new.
   *
   * This is the check the restatement is worth: ProductArt.tsx says in a comment
   * that its labels are that page's FEE_TIERS, and this is the only thing making
   * that true tomorrow.
   * ------------------------------------------------------------------ */
  const tierPairs = (src: string, name: string) =>
    [
      ...arrayBody(src, name).matchAll(/fee:\s*(\d+),\s*label:\s*"([^"]+)"/g),
    ].map((m) => `${m[1]}=${m[2]}`);

  const mine = tierPairs(artCode, "TIERS");
  const theirs = tierPairs(stripComments(poolSrc), "FEE_TIERS");
  check("parsed ProductArt's TIERS", mine.length === 3, mine.join(" "));
  check("parsed /pool/new's FEE_TIERS", theirs.length === 3, theirs.join(" "));
  check(
    "ProductArt's fee tiers match /pool/new's, in order",
    mine.length === theirs.length && mine.every((v, i) => v === theirs[i]),
    `art=[${mine.join(" ")}] pool=[${theirs.join(" ")}]`,
  );
  for (const pair of mine) {
    const fee = Number(pair.split("=")[0]);
    check(
      `fee ${fee} has a tick spacing the contract enforces`,
      typeof TICK_SPACINGS[fee] === "number" && TICK_SPACINGS[fee] > 0,
      String(TICK_SPACINGS[fee]),
    );
  }

  /* ------------------------------------------------------------------
   * 5. The book figure quotes capabilities.ts, not a second set of numbers.
   * ------------------------------------------------------------------ */
  const lending = GROUPS.find((g) => g.href === "/borrow");
  const example = (tool: string) =>
    lending?.tools.find((t) => t.name === tool)?.example as
      Record<string, unknown> | undefined;

  const amounts = [
    ...artCode.matchAll(/bookAmt\}>[\s\S]*?\/>\s*([\d,]+)\s+([A-Za-z]+)/g),
  ].map((m) => ({ amount: m[1].replace(/,/g, ""), token: m[2] }));
  const terms = [...artCode.matchAll(/bookTerms\}>([^<]+)</g)].map((m) =>
    m[1].trim(),
  );

  check(
    "found both sides of the book figure in source",
    amounts.length === 2 && terms.length === 2,
    `${amounts.length} amounts, ${terms.length} terms`,
  );

  for (const [i, tool] of ["borrow", "lend"].entries()) {
    const ex = example(tool);
    const amt = amounts[i];
    const term = terms[i];
    check(
      `capabilities.ts still has a ${tool} example`,
      ex !== undefined,
      tool,
    );
    check(
      `book figure's ${tool} amount is the ${tool} example's`,
      !!ex && !!amt && amt.amount === String(ex.amount),
      `figure=${amt?.amount} catalog=${ex?.amount}`,
    );
    check(
      `book figure's ${tool} token is the ${tool} example's`,
      !!ex && !!amt && amt.token === String(ex.token),
      `figure=${amt?.token} catalog=${ex?.token}`,
    );
    check(
      `book figure's ${tool} terms are the ${tool} example's`,
      !!ex && term === `${ex.interestPct}% · ${ex.days} days`,
      `figure="${term}" catalog="${ex?.interestPct}% · ${ex?.days} days"`,
    );
  }

  /* ------------------------------------------------------------------
   * 6. Nothing invented, restated as a source check.
   *
   * The docblock's promise is that no figure carries a price, a rate, a TVL or an
   * APY. Two of those are asserted specifically because they are the ones a future
   * edit would reach for first: products.ts makes "no advertised APY" a copy rule
   * for Stake, and the deleted price chart is why no dollar figure belongs here.
   * ------------------------------------------------------------------ */
  const strings = [...artCode.matchAll(/>([^<>{}]+)</g)]
    .map((m) => m[1].trim())
    .filter(Boolean)
    .join(" | ");
  check(
    "no dollar figure in any figure's copy",
    !/\$/.test(strings),
    strings.match(/[^|]*\$[^|]*/)?.[0] ?? "",
  );
  check(
    "no APY or exchange rate in any figure's copy",
    !/\bAPY\b|\bAPR\b/i.test(strings),
    strings.match(/[^|]*(APY|APR)[^|]*/i)?.[0] ?? "",
  );
  /* The percentages that ARE allowed: the three fee-tier labels and the two
     interest rates, all of which section 4 and 5 tie to a source. Anything else
     is a rate somebody typed. */
  const allowedPct = new Set([
    ...mine.map((p) => p.split("=")[1]),
    ...["borrow", "lend"].map((t) => `${example(t)?.interestPct}%`),
  ]);
  const foundPct = [...artCode.matchAll(/(\d+(?:\.\d+)?%)/g)].map((m) => m[1]);
  check(
    "every percentage in the figures is one this suite traced to a source",
    foundPct.every((p) => allowedPct.has(p)),
    `found=[${foundPct.join(" ")}] allowed=[${[...allowedPct].join(" ")}]`,
  );

  /* ------------------------------------------------------------------
   * 7. ProductArt stays static, and stays out of the wallet.
   *
   * (marketing)/layout.tsx: the landing page has exactly one state, and the
   * moment something here reaches for useWalletV2 or a resolver it has two.
   * ------------------------------------------------------------------ */
  const ALLOWED_IMPORTS = new Set([
    "@/components/v2/TokenIcon",
    "@/constants/utils/v3Math",
    "./products",
    "./ProductArt.module.css",
  ]);
  const imported = [...artCode.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  check(
    "ProductArt imports nothing beyond its four sources",
    imported.every((i) => ALLOWED_IMPORTS.has(i)),
    imported.filter((i) => !ALLOWED_IMPORTS.has(i)).join(",") || "",
  );
  check(
    "ProductArt is not a client component",
    !artCode.includes('"use client"'),
    "",
  );
  for (const banned of ["useState", "useEffect", "useRef", "fetch("]) {
    check(`ProductArt has no ${banned}`, !artCode.includes(banned), banned);
  }

  /* ------------------------------------------------------------------
   * 8. Class parity, both directions.
   *
   * A `s.typo` is `undefined` in the class attribute, which renders as a plainly
   * unstyled element rather than an error — the same silent failure as a missing
   * icon. The reverse direction catches a rule left behind after a rename, which
   * is how a stylesheet accumulates dead weight nobody dares delete.
   * ------------------------------------------------------------------ */
  const usedClasses = (src: string) =>
    new Set(
      [...src.matchAll(/\bs\.([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1]),
    );
  /* Comments stripped first: both stylesheets discuss class names in prose,
     including ones they deliberately do not define. */
  const definedClasses = (css: string) =>
    new Set(
      [
        ...css
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g),
      ].map((m) => m[1]),
    );

  for (const [name, src, css] of [
    ["ProductArt", artCode, artCss],
    ["ProductRail", stripComments(railSrc), railCss],
  ] as const) {
    const u = usedClasses(src);
    const d = definedClasses(css);
    const missing = [...u].filter((c) => !d.has(c));
    const unused = [...d].filter((c) => !u.has(c));
    check(
      `${name}: every class the component uses is defined`,
      missing.length === 0,
      missing.join(","),
    );
    check(
      `${name}: every class the stylesheet defines is used`,
      unused.length === 0,
      unused.join(","),
    );
  }

  /* ------------------------------------------------------------------
   * 9. Every way into a product is a route that exists, labelled the app's word.
   *
   * The panel footer used to be one "Open →" per product. It is now a row of two
   * or three named destinations, which multiplies the same silent failure the rest
   * of this suite is about: a <Link> to a route that does not exist type-checks,
   * renders, and 404s only when someone presses it. `next build` will not catch it
   * either — `href` is a string.
   *
   * The label half is the fee-tier check again in a different costume.
   * products.ts's rule is that a label IS the app's own tab word, so pressing
   * "Redeem" lands on a screen whose highlighted tab says Redeem. That is a
   * restatement, and a restatement drifts: rename the tab in stable/layout.tsx and
   * the landing page keeps promising the old word. Parsed out of the four shells
   * rather than trusted.
   * ------------------------------------------------------------------ */

  /** Every `page.tsx` under src/app, as the URL Next.js will serve it at. */
  const routes = new Set<string>();
  const walk = (dir: string, url: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (e.isDirectory()) {
        /* A parenthesised segment is a route group — it organises files and
           contributes nothing to the URL, which is exactly why /borrow lives at
           (app)/(lending)/borrow and a naive path check would miss it. */
        const seg = /^\(.*\)$/.test(e.name) ? url : `${url}/${e.name}`;
        walk(`${dir}/${e.name}`, seg);
      } else if (e.name === "page.tsx") {
        routes.add(url || "/");
      }
    }
  };
  walk("src/app", "");

  check(
    "walked src/app and found its routes",
    routes.size >= 10,
    `${routes.size} routes`,
  );
  check(
    "the route walk handles route groups (/borrow resolves through (lending))",
    routes.has("/borrow"),
    [...routes].sort().join(" "),
  );

  /* href → label, from the shells' own TABS arrays. */
  const appTabs: Record<string, string> = {};
  for (const layout of [
    "src/app/(app)/trade/layout.tsx",
    "src/app/(app)/stable/layout.tsx",
    "src/app/(app)/pool/layout.tsx",
    "src/app/(app)/(lending)/layout.tsx",
  ]) {
    const body = arrayBody(stripComments(read(layout)), "TABS");
    for (const m of body.matchAll(/href:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g))
      appTabs[m[1]] = m[2];
  }
  check(
    "parsed the app's own tab strips",
    Object.keys(appTabs).length >= 12,
    JSON.stringify(appTabs),
  );

  for (const p of PRODUCTS) {
    check(
      `${p.name}: has between one and three ways in`,
      p.links.length >= 1 && p.links.length <= 3,
      `${p.links.length} links`,
    );
    check(
      `${p.name}: no duplicate destination`,
      new Set(p.links.map((l) => l.href)).size === p.links.length,
      p.links.map((l) => l.href).join(","),
    );
    for (const l of p.links) {
      check(
        `${p.name}: ${l.href} is a route that exists`,
        routes.has(l.href),
        "no page.tsx serves it",
      );
      /* Only the ones the app actually tabs. /pool/new is a heading and a CTA
         rather than a tab, and /stake has no strip at all — for those, existence
         above is the whole guarantee available. */
      if (appTabs[l.href] !== undefined) {
        check(
          `${p.name}: "${l.label}" is the app's own word for ${l.href}`,
          l.label === appTabs[l.href],
          `page="${l.label}" app="${appTabs[l.href]}"`,
        );
      }
    }
  }

  /* The one the row exists for. Recorded as its own assertion because "route to
     the offramp" was the request, and /trade/sell is the only off-ramp in the
     app — a future rename that moved it would otherwise fail as an anonymous
     missing route. */
  const trade = PRODUCTS.find((p) => p.name === "Trade");
  check(
    "Trade's row reaches the fiat off-ramp",
    !!trade?.links.some((l) => l.href === "/trade/sell"),
    trade?.links.map((l) => l.href).join(",") ?? "no Trade product",
  );
  check(
    "/trade/sell is still the MoonPay off-ramp it is being linked to as",
    read("src/app/(app)/trade/sell/page.tsx").includes('mode: "sell"'),
    "the sell page no longer posts mode:sell to /api/moonpay",
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
