/**
 * The docs site's information architecture, and the pure helpers around it.
 *
 * ---------------------------------------------------------------------------
 * THE MANIFEST IS AN ALLOW-LIST, NOT A FILTER
 * ---------------------------------------------------------------------------
 * `DOC_GROUPS` is written by hand and there is deliberately no directory glob
 * anywhere in this feature. A markdown file that appears in `docs/` is invisible
 * to the public site until somebody adds a line here.
 *
 * That is the whole safety property, and it is worth stating why it has to be
 * structural rather than a rule someone remembers. `docs/` is two folders in one.
 * `docs/product/` is written for this site and every file in it is published.
 * Everything around it is an engineering folder: it holds an attack-vector
 * checklist against our own contracts, an inventory of which screens are wired
 * and which are not, three files whose titles end in STATUS, and a table of three
 * conflicting addresses for the same token. None of that is documentation — it is
 * working notes that happen to be markdown, and a glob over the folder would
 * publish every one of them the moment it was written. An allow-list fails closed.
 *
 * The `docs/product/` split is a convenience, not the boundary. The boundary is
 * this file, and a new page there is as invisible as a new status note until it
 * is listed below.
 *
 * ---------------------------------------------------------------------------
 * `omit`, AND WHY SECTION-LEVEL GRANULARITY IS NEEDED AT ALL
 * ---------------------------------------------------------------------------
 * Some documents are publishable except for a section or two — a deploy command
 * meant for us, a changelog of touched files, a paragraph recording that a value
 * is still hardcoded. Rewriting those files to strip such sections would fork
 * the content: the repo copy is the one engineers read and edit, and a second
 * public copy drifts from it within a month.
 *
 * So `omit` names the exact heading lines whose sections come out on the way to
 * the page. Each named heading is dropped along with everything under it, up to
 * the next heading at the same or a shallower depth — so omitting `## Deployment`
 * takes its `###` children with it, and omitting a `###` leaves its siblings
 * alone. The source file is never modified.
 *
 * The mechanism is only as good as its failure mode, which is why
 * `docs.test.ts` asserts every `omit` string is actually present in its file. A
 * reworded heading then fails a test run instead of silently publishing the
 * section it was meant to remove.
 *
 * Only one entry still needs it. That is the point of `docs/product/`: a page
 * written for the site has nothing in it to omit, and a page that needs three
 * omissions to be publishable was probably never a page.
 *
 * ---------------------------------------------------------------------------
 * NO FRONTMATTER, SO TITLES AND ORDER LIVE HERE
 * ---------------------------------------------------------------------------
 * Not one file in `docs/` has frontmatter, and adding it to the twenty-one
 * engineering documents would be a change to twenty-one engineering documents in
 * service of a website. `title` here is the sidebar and browser-tab label; the
 * page's own H1 still comes from the markdown, so the two differ on purpose —
 * the sidebar wants the short noun ("Fees") and the page wants a sentence
 * ("Every charge, and who takes it"). `docs.test.ts` asserts they are never
 * equal, so a title copied from an H1 fails rather than producing a page that
 * says the same thing twice.
 *
 * ---------------------------------------------------------------------------
 * IMAGES
 * ---------------------------------------------------------------------------
 * Figures are SVGs under `public/docs-media/`, referenced root-relative
 * (`/docs-media/x.svg`) so the path Next serves them from is the path in the
 * markdown. Each carries alt text and a markdown title, which `DocBody` renders
 * as a caption. `docs.test.ts` walks them separately from links, because
 * `![a](b)` contains `[a](b)` and a link checker that does not know the
 * difference will try to resolve an image src as a relative document path.
 *
 * App routes are written as inline code (`` `/trade/swap` ``) rather than as
 * links, for the same class of reason: a root-relative link is correct in the
 * browser but is neither a document path nor an absolute URL, so it sits in the
 * one gap between the link checker's two branches. Code spans read correctly and
 * are checkable.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE MUST STAY CLIENT-SAFE
 * ---------------------------------------------------------------------------
 * `DocsSidebar` is a client component and imports `DOC_GROUPS` for the nav and
 * the filter. So nothing here may touch `node:fs` — reading files is
 * `docsSource.ts`, which is server-only by virtue of being imported only from
 * server components. (`server-only` is not installed, or that boundary would be
 * declared rather than described.)
 */

/** The repository, which is also where anything not published still resolves. */
export const REPO = "https://github.com/kaleidofinance/Kaleido-os";
export const REPO_BLOB = `${REPO}/blob/main`;
export const REPO_TREE = `${REPO}/tree/main`;

export interface DocEntry {
  /** URL segment. `/docs/<slug>`, kebab-case, no group prefix. */
  slug: string;
  /** Source path, relative to the repository root, posix separators. */
  file: string;
  /** Sidebar and `<title>` label. Not necessarily the file's own H1. */
  title: string;
  /** One line, for the index cards and the meta description. */
  blurb: string;
  /**
   * Exact heading lines, including their `#` markers, whose sections are dropped.
   * Asserted present by docs.test.ts.
   */
  omit?: string[];
  /**
   * Exact literal text removed wherever it appears, for prose that refers to an
   * omitted section. Section granularity cannot reach a clause in a paragraph,
   * and a page that says "see X below" with no X below is broken in a way the
   * reader notices. Each string must leave grammatical text behind, and each is
   * asserted present by docs.test.ts for the same reason `omit` is.
   */
  strip?: string[];
}

export interface DocGroup {
  label: string;
  entries: DocEntry[];
}

/**
 * The published set.
 *
 * Fifteen pages out of thirty-five files. Fourteen of the fifteen were written for
 * this site and live in `docs/product/`; the fifteenth is an engineering document
 * that happens to be publishable with two sections removed. Everything else is
 * recorded in `UNPUBLISHED` with its reason, so the decision is reviewable and
 * reversible one line at a time rather than re-argued from scratch.
 *
 * Order is the reading order, not the alphabet. Someone who has never used the
 * protocol should be able to start at the top of the sidebar and work down: what
 * it is, how to begin, then one page per product, then the agent, then the parts
 * you only want once you are already using it.
 */
export const DOC_GROUPS: DocGroup[] = [
  {
    label: "Get started",
    entries: [
      {
        slug: "overview",
        file: "docs/product/overview.md",
        title: "What Kaleido is",
        blurb:
          "Five products behind one wallet connection: swaps, concentrated liquidity, peer-to-peer lending, a yield-bearing stablecoin and staking — on five chains, with an agent that can drive all of it.",
      },
      {
        slug: "getting-started",
        file: "docs/product/getting-started.md",
        title: "Getting started",
        blurb:
          "Connect, get testnet funds from the faucet, and make your first swap — then the three things worth knowing before you borrow against anything.",
      },
    ],
  },
  {
    label: "Products",
    entries: [
      {
        slug: "trade",
        file: "docs/product/trade.md",
        title: "Swap",
        blurb:
          "How a quote is built, what slippage and price impact actually mean here, and which of the three fee tiers a pair should trade in.",
      },
      {
        slug: "liquidity",
        file: "docs/product/liquidity.md",
        title: "Liquidity",
        blurb:
          "Concentrated liquidity in plain terms: choosing a range, what happens when price leaves it, and the trade you are making when you narrow one.",
      },
      {
        slug: "borrow",
        file: "docs/product/borrow.md",
        title: "Borrow and lend",
        blurb:
          "A peer-to-peer book with no utilisation curve: requests, listings, fixed-at-origination interest, the health factor, and how liquidation pays out.",
      },
      {
        slug: "stake",
        file: "docs/product/stake.md",
        title: "Staking",
        blurb:
          "Deposit KLD, hold rebasing stKLD, and leave in three moves across a seven-day wait — with no fee anywhere on the path.",
      },
      {
        slug: "stable",
        file: "docs/product/stable.md",
        title: "Stablecoin",
        blurb:
          "kfUSD is the dollar and kafUSD is the yield-bearing claim on it: minting, redeeming, locking, and exactly how the yield reaches a holder.",
      },
    ],
  },
  {
    label: "The agent",
    entries: [
      {
        slug: "agent",
        file: "docs/product/agent.md",
        title: "The agent",
        blurb:
          "Twenty-four actions and seven reads driven from a sentence, with a second model auditing the plan before anything reaches your wallet to sign.",
      },
      {
        slug: "delegation",
        file: "docs/product/delegation.md",
        title: "Delegation",
        blurb:
          "One transaction granting an agent bounded authority over your lending positions — nine parameters, enforced by the contract rather than by the app.",
      },
    ],
  },
  {
    label: "Under the hood",
    entries: [
      {
        slug: "architecture",
        file: "docs/product/architecture.md",
        title: "Architecture",
        blurb:
          "One diamond address per chain, five facets behind it, a generated registry holding every address, and one oracle interface over two backends.",
      },
      {
        slug: "fees",
        file: "docs/product/fees.md",
        title: "Fees",
        blurb:
          "Every charge in the protocol in one table each: the rate, who receives it, and the ceiling the contract will not let it past.",
      },
    ],
  },
  {
    label: "Networks",
    entries: [
      {
        slug: "deployments",
        file: "docs/MULTICHAIN_DEPLOYMENT_MAP.md",
        title: "Deployment map",
        blurb:
          "What has to exist on a chain before the app can point at it: our contracts, the external dependencies, and what must be verified per deployment.",
        omit: [
          /* Names an unfixed, self-described highest-risk item in our own
             contracts. Same objection as the security folder: it is a to-do list
             for an attacker, published ahead of the code it describes. */
          "## Hardcoded values that block a clean multichain deploy",
          /* Publishes three conflicting addresses for kfUSD and says which one is
             live cannot be settled from the repo. True, useful internally, and
             the opposite of useful to a reader looking up an address. */
          "## Known drift (why the registry exists)",
        ],
        /* The intro's methodology aside, which forward-references the section
           above. Removing the clause rather than the sentence leaves "derived by
           reading the contracts and deploy scripts." — which is both grammatical
           and the part a reader of a deployment map actually wants. */
        strip: [
          ' rather than the previous docs (which\ndisagree with each other — see "Known drift" below)',
        ],
      },
    ],
  },
  {
    label: "Token economy",
    entries: [
      {
        slug: "token",
        file: "docs/product/token.md",
        title: "KLD and its supply",
        blurb:
          "One billion KLD across eight buckets, the unlock curve those buckets produce, and the two invariants that keep the ceiling global rather than per chain.",
      },
    ],
  },
  {
    label: "The project",
    entries: [
      {
        slug: "roadmap",
        file: "docs/product/roadmap.md",
        title: "Roadmap",
        blurb:
          "What has shipped, what lands at mainnet and at the token generation event, and the three things deliberately left off the list.",
      },
      {
        slug: "brand",
        file: "docs/product/brand.md",
        title: "Brand and links",
        blurb:
          "The wordmark, the palette read out of the stylesheet the product uses, the type scale, and the only domains and repository that are ours.",
      },
    ],
  },
];

export const ALL_DOCS: DocEntry[] = DOC_GROUPS.flatMap((g) => g.entries);

/** Source path to slug, which is what makes a cross-document link rewritable. */
export const FILE_TO_SLUG: Record<string, string> = Object.fromEntries(
  ALL_DOCS.map((d) => [d.file, d.slug]),
);

export function docBySlug(slug: string): DocEntry | undefined {
  return ALL_DOCS.find((d) => d.slug === slug);
}

/**
 * Everything in `docs/` that is deliberately not on the site, and why.
 *
 * Kept in code rather than in a commit message because the question "why isn't
 * the security audit on the docs site?" will be asked again, and the answer
 * should be next to the list it applies to. The test file reads this to assert
 * the two sets are disjoint and that together they account for every file in
 * `docs/` — so a new document cannot be added to the repo without someone making
 * a decision about it here.
 */
export const UNPUBLISHED: Record<string, string> = {
  "docs/README.md":
    "A GitHub file-browser index: emoji headings, a Contributing section, Document Conventions. The /docs index replaces its job.",
  "docs/KLD_MULTICHAIN_PLAN.md":
    "A build plan for a bridge that does not exist yet — a numbered sequence with blocked-by columns, rate-limit figures still to be set against real float, and a rejected custodial option written down so nobody re-proposes it. Publishing it would advertise which chains KLD cannot reach and which invariant is enforced only by a keeper. The deployment map beside it is the publishable half.",
  "docs/points-system.md":
    "An internal engineering spec. Opens by recording that the runtime is not built, cross-references its own implementation plan throughout, and carries a database schema and a disclosure policy.",
  "docs/interface-inventory.md":
    "An audit of which screens are wired and which are not, including the demo fixtures. Build-state by definition.",
  "docs/KEEPER_SCHEDULING.md":
    "An operator runbook for arming an endpoint that spends the keeper's gas: which environment variables authenticate it, which header carries the secret, and the exact interval it must be called on. It also records the measured rate at which our own oracle currently goes stale, and which feed's bound is the tightest. Every one of those is a thing a reader would use to find the protocol priced by a stale feed, and none of it is useful to someone using the app.",
  "docs/TESTNET_INVITE_CAMPAIGN.md":
    "The send plan for the testnet access code: how the recipient list is handled, the sending domain's DNS, the warm-up schedule, and the bounce and complaint rates at which the send stops. Publishing it would hand a reader the campaign's timing and its exact From address ahead of the mail itself, which is the one thing that makes the anti-phishing announcement work. It also states plainly that the shared code is expected to go public within a day and that the faucet is the exposed surface afterwards — true, and not an invitation to extend to everyone.",
  "docs/CLAUDE_IMPORTS/kaleido-os-main-5c-4980.md":
    "An AI tooling artifact, not a document.",
  "docs/guides/STABLECOIN_INTEGRATION.md":
    "A build-state tracker end to end — the H1 says Status and the two top sections are Completed and Pending Implementation. No publishable slice.",
  "docs/guides/README.md":
    "Integration notes for engineers: Solidity signatures, owner-only setters, a hardhat command against our own deploy script. Two things in it are now false — the mint and redeem fees are quoted at 0.3% each where the deployed value is 0.05%, and Network Configuration says the system runs on Abstract only, which stopped being true when the registry became chain-scoped. Published as four sections with the rest omitted until 2026-08-27; docs/product/stable.md now covers the same ground written for a reader rather than a caller.",
  "docs/guides/COLLATERAL_TO_POOLS_FLOW.md":
    "A contract-level walk-through of the deposit path, function call by function call, for someone changing that path rather than using it. The publishable half is now docs/product/stable.md, which states where the collateral sits without the call sequence.",
  "docs/guides/FEATURED_POOL_INTEGRATION.md":
    "Describes a design that is half built. The isFeatured listing flag and its setter are in ProtocolFacet, but VaultFeaturedPool.sol — the contract every step of the document depends on — was never written, so the flow it walks through cannot be performed. It also carries a Files Changed changelog, a Future Enhancements wish list, and a 12% APY quoted as configuration. Republish it if the pool contract lands.",
  "docs/guides/REDEMPTION_GUIDE.md":
    "Not a redemption guide: a troubleshooting note explaining why redemption currently fails because no collateral has been deposited yet.",
  "docs/guides/FEATURED_POOL_RATES.md":
    "Internal market research quoting competitor APYs as of 2024. Two years stale, and rates are the last thing that should be published from a research note.",
  "docs/guides/INTEREST_RATE_RESEARCH.md":
    "Internal research behind a parameter choice.",
  "docs/guides/RUN_TESTS.md": "Developer workflow. Belongs in the repo README.",
  "docs/guides/TESTNET_DEPLOYMENT_GUIDE.md":
    "Operator runbook for our own testnet deploys.",
  "docs/guides/YIELD_TESTING_STATUS.md": "A status document.",
  "docs/security/SECURITY_AUDIT.md":
    "An attack-vector checklist against our own contracts, published ahead of the code it describes.",
  "docs/security/SECURITY_AUDIT_COMPLETE.md":
    "Internal audit record, including a self-assigned security score and next steps.",
  "docs/security/SECURITY_FINDINGS.md":
    "Names potential vulnerabilities, areas requiring attention and critical actions before mainnet. Nothing is deployed yet; this is a roadmap for whoever reads it first.",
  "docs/security/SECURITY_TESTING.md":
    "How we run security tests, including which tools to point at the contracts.",
  "docs/security/SECURITY_TESTING_STATUS.md": "A status document.",
};

/* -------------------------------------------------------------------------- */
/*  Line endings                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Collapse CRLF to LF before anything tries to parse a line.
 *
 * `MULTICHAIN_DEPLOYMENT_MAP.md` IS CRLF ON EVERY ONE OF ITS 134 LINES, and it is
 * the one published file that still needs `omit`. That coincidence is not lucky,
 * it is the bug this function exists to have already fixed, and it is worth
 * writing down exactly how it bites, because it is invisible:
 *
 *   In JavaScript regular expressions, `.` does not match a line terminator, and
 *   CR is a line terminator. So `/^(#{1,6})\s+.+$/` — an entirely reasonable
 *   heading pattern — cannot match `"## Deployment\r"`: `.+` stops before the CR,
 *   and `$` without the `m` flag only matches at the very end of the string,
 *   which is after it.
 *
 * The consequence was that `omitSections` recognised no headings at all and
 * returned every document unchanged. It did not throw, log, or render oddly. It
 * published every internal section while reporting success, and the only thing
 * that caught it was the test asserting the omitted text was gone.
 *
 * The pages in `docs/product/` are LF, which is exactly why this must not be
 * relaxed to suit them: the file that would break is the one nobody is editing,
 * and it would break silently. `docs.test.ts` asserts a published source still
 * contains CRLF for that reason — so the normalisation keeps being exercised.
 *
 * So the parsers normalise first rather than each pattern being written to
 * tolerate CR. Patterns written that way are correct once and then copied by the
 * next person without the reasoning; normalising means a line is a line.
 */
export function normalizeEol(md: string): string {
  return md.replace(/\r\n?/g, "\n");
}

/* -------------------------------------------------------------------------- */
/*  Slugs                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A heading's anchor.
 *
 * Deliberately aggressive: everything that is not a lowercase letter or digit
 * becomes a separator, and runs collapse. That handles the three things this
 * content actually contains — inline code in headings (`### Frontend: Mint kfUSD`),
 * em dashes and section signs, and emoji — without a table of special cases, and
 * without `github-slugger`, which is not installed.
 *
 * It does mean the anchors do not match GitHub's for the same headings. That
 * would matter if links from elsewhere pointed at `/docs/<slug>#<github-anchor>`;
 * nothing does, and every in-page link on the site is generated from this
 * function, so the only requirement is internal consistency.
 */
export function slugify(text: string): string {
  return stripInline(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Heading text with markdown markers removed, for the sidebar and the TOC.
 *
 * `[label](href)` keeps the label, because a heading containing a link should
 * read as its words in a table of contents rather than as its URL.
 */
export function stripInline(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_)/g, "")
    .trim();
}

export interface Heading {
  depth: 2 | 3;
  text: string;
  id: string;
}

/**
 * The page's H2s and H3s, in document order, with unique ids.
 *
 * FENCED CODE IS SKIPPED, and that is not a nicety. These documents contain 19
 * bash fences and a pile of ASCII flow diagrams; `# install deps` inside one is a
 * comment, and a naive line scan would put it in the table of contents as a
 * top-level heading. The fence tracker is a plain toggle on ``` or ~~~ because
 * that is what the content uses — no nested or longer fences appear.
 *
 * H1 is excluded because the page renders it as its title, and a table of
 * contents whose first entry is the title of the page it is on is noise.
 *
 * Duplicate ids get a numeric suffix. Needed in practice: several documents open
 * more than one section with `### Overview`, and two identical `id`s mean the
 * second TOC link scrolls to the first section.
 */
export function scanHeadings(md: string): Heading[] {
  const out: Heading[] = [];
  const seen = new Map<string, number>();
  let fenced = false;

  for (const line of normalizeEol(md).split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;

    const text = stripInline(m[2]);
    const base = slugify(m[2]) || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);

    out.push({
      depth: m[1].length as 2 | 3,
      text,
      id: n === 0 ? base : `${base}-${n}`,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Omitting sections                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Drop each named heading and everything beneath it.
 *
 * "Beneath it" means up to the next heading at the same or a shallower depth, so
 * a `##` takes its `###` children and a `###` does not disturb its siblings.
 *
 * Two details that are easy to get wrong:
 *
 * Fenced code is tracked here too. A `##` at the start of a line inside a fence
 * is not a heading, and treating one as the boundary of a section would end the
 * removal early and leave the tail of an omitted section on the page — a failure
 * that looks like a formatting glitch rather than like a leak.
 *
 * A horizontal rule immediately before a removed section goes with it. These
 * documents separate sections with `---`, so removing the section alone leaves a
 * rule with nothing on either side of it.
 */
export function omitSections(md: string, omit: string[]): string {
  if (omit.length === 0) return normalizeEol(md);

  const targets = new Set(omit.map((h) => h.trim()));
  const lines = normalizeEol(md).split("\n");
  const keep: string[] = [];
  let fenced = false;
  let skipDepth = 0;

  for (const line of lines) {
    const isFence = /^\s*(```|~~~)/.test(line);
    if (isFence) fenced = !fenced;

    /* `.+?\s*$` rather than `.+$` — see normalizeEol. The input is normalised, so
       this is belt and braces, and it is the shape every heading pattern in this
       feature uses so that none of them can be copied wrong. */
    const heading = fenced || isFence ? null : /^(#{1,6})\s+.+?\s*$/.exec(line);

    if (skipDepth > 0) {
      /* Still inside a removed section until a heading at the same or a
         shallower level turns up. */
      if (heading && heading[1].length <= skipDepth) {
        skipDepth = 0;
      } else {
        continue;
      }
    }

    if (heading && targets.has(line.trim())) {
      skipDepth = heading[1].length;
      /* Take the rule and the blank line that introduced this section. */
      while (keep.length > 0 && keep[keep.length - 1].trim() === "") keep.pop();
      if (
        keep.length > 0 &&
        /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(keep[keep.length - 1])
      ) {
        keep.pop();
      }
      continue;
    }

    keep.push(line);
  }

  return `${keep.join("\n").replace(/\s+$/, "")}\n`;
}

/**
 * Remove each literal phrase wherever it occurs.
 *
 * The companion to `omitSections`, for the case section granularity cannot reach:
 * a clause inside a paragraph that points at a section which is no longer there.
 * `MULTICHAIN_DEPLOYMENT_MAP.md` opens with one — `see "Known drift" below` — and
 * dropping the section without the reference would publish a page that tells the
 * reader to look for something that is not on it.
 *
 * A literal `split`/`join` rather than a regex, so a phrase containing `(`, `.`
 * or `?` — and the one this exists for contains all three — needs no escaping and
 * cannot accidentally become a pattern that matches more than it was meant to.
 * Whitespace is normalised first so a phrase spanning a line break can be written
 * with `\n` in the manifest and still match a CRLF file.
 */
export function stripPhrases(md: string, strip: string[]): string {
  let out = normalizeEol(md);
  for (const phrase of strip) out = out.split(normalizeEol(phrase)).join("");
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Links                                                                     */
/* -------------------------------------------------------------------------- */

export interface ResolvedLink {
  href: string;
  /** Opens in a new tab and gets `rel="noopener noreferrer"`. */
  external: boolean;
}

/**
 * Where a link in a markdown document should actually point.
 *
 * The published set links out 59 times, with paths like `./fees.md` and
 * `../../smart-contract/contracts/facets/ProtocolFacet.sol` — the first kind
 * written for this site, the second written the way GitHub's file browser reads
 * them. Rendered as-is on a web page every one of them 404s, and a docs site whose
 * internal links are dead is the specific failure this function exists to prevent
 * — it is also the failure that looks fine in a screenshot, which is why
 * `docs.test.ts` walks every one of them.
 *
 * Four outcomes:
 *
 *   published document  ->  /docs/<slug>, fragment preserved
 *   real file, not published  ->  the GitHub blob URL, so it still resolves
 *   a directory  ->  the GitHub tree URL
 *   already absolute or a fragment  ->  untouched
 *
 * The second case is the one worth defending. The alternative — dropping the
 * link, or pointing it at the docs index — hides the fact that a reference
 * exists. Sending the reader to the repository is honest: the document is real,
 * it is just not part of the public site.
 */
export function resolveDocLink(href: string, fromFile: string): ResolvedLink {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
    return { href, external: true };
  }
  /* In-page, or already an app path. Both are correct as written. */
  if (href.startsWith("#") || href.startsWith("/")) {
    return { href, external: false };
  }

  const hash = href.indexOf("#");
  const path = hash === -1 ? href : href.slice(0, hash);
  const frag = hash === -1 ? "" : href.slice(hash);

  const base = fromFile.slice(0, fromFile.lastIndexOf("/"));
  const resolved = resolvePosix(base, path);

  const slug = FILE_TO_SLUG[resolved];
  if (slug) return { href: `/docs/${slug}${frag}`, external: false };

  if (path.endsWith("/")) {
    return { href: `${REPO_TREE}/${resolved}`, external: true };
  }
  return { href: `${REPO_BLOB}/${resolved}${frag}`, external: true };
}

/**
 * `path.posix.join` for the one case this needs, written out because `node:path`
 * would drag a node builtin into a module the sidebar imports on the client.
 */
export function resolvePosix(baseDir: string, rel: string): string {
  const parts = baseDir === "" ? [] : baseDir.split("/");
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}
