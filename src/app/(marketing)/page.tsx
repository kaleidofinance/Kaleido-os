import type { Metadata } from "next";
import Link from "next/link";
import ThemeToggle from "@/components/v2/ThemeToggle";
import ChainIcon from "@/components/v2/ChainIcon";
import Brand from "./_components/Brand";
import CapabilityTabs from "./_components/CapabilityTabs";
import HeroArc from "./_components/HeroArc";
import LivePlanner from "./_components/LivePlanner";
import ProductRail from "./_components/ProductRail";
import { ALL_TOOLS, EXECUTE_COUNT, READS } from "./_components/capabilities";
import { PRODUCTS } from "./_components/products";
import { getCapabilityTraces } from "./_components/traces";
import s from "./marketing.module.css";

/**
 * The landing page.
 *
 * A server component by default and deliberately: everything below is static
 * text, and the one interactive part — the planner — is a `"use client"` leaf. So
 * this route prerenders, and the JS a visitor downloads is that plus the theme
 * toggle, not the page.
 *
 * Five rules govern the copy, and all five are easy to break by accident:
 *
 *   1. **Capability first.** What is being sold is the agent's reach: it
 *      performs transactions across the stack, it moves funds, it plans a
 *      strategy. The DeFi stack underneath is what gives it something to act on
 *      — a plus, not the headline. The guardrails are engineering, described as
 *      engineering, never as the pitch.
 *   2. **Nothing overstated.** Bridges quote but do not execute; staking
 *      advertises no APY. Scope limits like those are stated on the page in the
 *      same words the app uses when a user asks (src/lib/ai/faq.ts), because a
 *      landing page that contradicts the product's own answers is worse than one
 *      that says less.
 *   3. **No build-state notices.** No "pre-launch", no "contracts redeploying",
 *      no "nothing is deployed yet", and no disclaimer block. This page is read
 *      by the public, and the public arrives after release — so a notice about
 *      today's deploy state addresses a reader who never sees it and is false
 *      for everyone who does. Where something is genuinely unbuilt, the app
 *      says so at the point of use, from state (isDeployed(), hasFeed()), not in
 *      prose here. An earlier version had a hero chip, a rollout apology and a
 *      footer disclaimer; all three are gone on purpose.
 *
 *      **The roadmap is the exception, and it is not really one.** §7 carries
 *      dated milestones — mainnet in September 2026, TGE by the end of it — and
 *      a schedule of what ships when is the opposite of an apology about today.
 *      Every protocol publishes one, and it stays true after release, because a
 *      reader in October reads a September milestone as history. What rule 3
 *      still bans inside that section is commentary about the schedule: no
 *      "targets, not promises", no asterisk, no hedge in the heading. Move the
 *      date instead. The ROADMAP docblock has the long version.
 *   4. **Show the product, then caption it.** This is the newest rule and the
 *      one this file most recently broke. Every section used to open with a
 *      heading, a forty-word intro and a grid of cards holding thirty- to
 *      sixty-word paragraphs — about 1,400 words of body copy, and the one real
 *      component buried in section two behind its own heading and intro. It read
 *      as documentation, not as a product page. So: **an artifact leads and the
 *      words caption it.** The hero holds the planner. A capability card's content
 *      is the tool names, not a paragraph about them. The products section draws
 *      each product's real mechanism — tick range, collateral set, fee tiers —
 *      rather than describing it. Section intros are one line. Card bodies are one
 *      line. If a body needs a second sentence, the first one was not the point.
 *
 *      There is no app screenshot under the hero any more, and its removal is the
 *      rule working rather than an exception to it. A framed shot of `/trade/agent`
 *      sat there, captioned "the panel above runs the same planner" — which was
 *      true, and was the problem: the hero panel *is* that composer, ported and
 *      live. A picture of the thing directly beneath the thing is the same artifact
 *      twice, and the live one is the better evidence. Do not put it back; if the
 *      app needs showing off, show a part of it the hero does not already run.
 *   5. **Every section is a different shape.** Nine sections and two component
 *      shapes is what made the middle of this page unreadable — four consecutive
 *      explainer blocks, each a left-aligned head over a grid of glass cards. The
 *      sequence now runs two-column hero, tab set, rail and panel, three numbered
 *      steps, ordered list beside a caveat card, card grid, horizontal timeline,
 *      centred close. Every shape appears once. The last repetition was §6 and
 *      §7 both being card grids, and §7 became a timeline.
 *
 *      §7 is four columns and §6 is a grid of cards, which is close enough to be
 *      worth naming: what separates them is that the roadmap has no panel around
 *      each phase and a rail through all four, so it reads as one sequence rather
 *      than as four things of the same kind. Do not give those columns a border —
 *      that is the edit that turns §7 back into the repetition.
 *
 *      Before adding a section, name its shape; if it is one already above it, it
 *      belongs inside that one instead.
 *
 * NO PROTOCOL STAT STRIP, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT.
 * Rule 4 was first read as "put figures above the fold", and the pillars were
 * replaced with four live tiles off `/api/market/overview` — lending TVL, loans
 * outstanding, kfUSD supply, KLD staked. It was removed, because two of those
 * four are the wrong kind of figure for a front door and the mock-data flag was
 * the only reason they looked otherwise:
 *
 *   - `Loans outstanding` is a **count**. Aave publishes total borrows in
 *     dollars; a landing page that publishes "6" has volunteered its own
 *     smallness. A count only flatters a protocol once it is large enough to be
 *     a dollar figure instead.
 *   - `Lending TVL` and `Loans outstanding` are both **zero on real data**,
 *     because the lending book is empty. So with NEXT_PUBLIC_MOCK_DATA off, the
 *     strip opened the page on "$0" — the single worst number to lead with, and
 *     invisible during development precisely because the flag is on.
 *
 * The general rule, if a strip is ever wanted here again: a front-door figure
 * has to be a dollar magnitude that is large on **real** data, checked with the
 * mock flag off. Two of the four passed that test (kfUSD supply, KLD staked) and
 * two tiles is not a strip. The hero does not need one — a visitor can type into
 * the planner, which is a stronger first impression than any number.
 *
 * The product rail's embedded price chart was cut for the same reason and it is
 * worth stating twice: with the flag on it printed a 19% ETH day. ProductRail.tsx
 * carries the full note. Nothing on this page may show a market figure.
 *
 * The one embedded component left is real and wallet-free, and both halves of
 * that matter. Real: `LivePlanner` runs the product's own parser, so the plan a
 * visitor sees is the plan the app would build. Wallet-free: layout.tsx of this
 * route group forbids `useWalletV2` and `useResolverContext` here, because the
 * front door should have one state rather than a connected and a disconnected
 * one. A "character component" that needed a signer would break that.
 *
 * One thing the copy must never imply: that the on-chain agent mandate scopes a
 * send. `LibAgentPermission.enforce()` gates calls into the diamond, and a
 * wallet-to-wallet transfer never enters it. The architecture section says
 * "protocol actions" for exactly that reason — do not widen it.
 */

/*
 * No `openGraph` and no `twitter` here, and that is load-bearing rather than an
 * omission. Both keys merge by replacement, so declaring either one on this
 * route would overwrite the root's object — and the 1200x630 card is attached
 * to the root segment via src/app/opengraph-image.png, so the overwrite takes
 * the image down with it and this page ships with no link preview at all. The
 * mechanism, and the earlier version of this comment that claimed the opposite,
 * are both documented in src/app/layout.tsx, where the share copy now lives.
 *
 * `title` and `description` are safe to set here: they are ordinary scalars, so
 * a page-level value simply wins for this route.
 *
 * The description is written to fit a result snippet — roughly 155 characters,
 * which is where Google truncates. It used to run 290 and got cut mid-sentence,
 * so the half a searcher actually read ended at "builds an ordered plan across".
 *
 * THE TITLE IS THE STRING THE CURRENT PRODUCTION PAGE ALREADY CARRIES, verbatim
 * down to the pipe, and that is continuity rather than inertia: kaleidofi.xyz has
 * been serving "Kaleido DeFi-OS | The Autonomous Financial Layer" as its
 * `<title>`, so it is what search results and every existing link preview show.
 * Replacing this route's h1 is a design decision; replacing the indexed title is a
 * different and larger one, and the two do not have to be the same string. They do
 * now overlap, and on purpose rather than by drift: the h1 spells out in full the
 * category this title compresses to "DeFi-OS", so a searcher who reads the result
 * and then lands on the page meets one claim twice rather than two claims once.
 * The hero's eyebrow gave up that abbreviation to make room — see §1.
 */
export const metadata: Metadata = {
  title: "Kaleido DeFi-OS | The Autonomous Financial Layer",
  description:
    "Tell it what you want. Luca plans across swaps, lending, liquidity, staking and stablecoins — priced, audited, signed by you. Non-custodial, open source.",
  alternates: { canonical: "/" },
};

const REPO = "https://github.com/kaleidofinance/Kaleido-os";

/**
 * Docs now live on this site, at /docs.
 *
 * This was `${REPO}/tree/main/docs` — GitHub's file browser. Four links on this
 * page sent a reader who wanted to understand the protocol out to a directory
 * listing: no navigation, no in-page structure, no way to move between documents,
 * and gone from the product. `/docs` renders the same files from the same
 * repository with a sidebar and a table of contents, and each page still links to
 * its source file for anyone who wants the raw markdown or wants to correct it.
 */
const DOCS = "/docs";

/**
 * Where "Launch app" goes. The app's own front door, not this deployment's
 * `/trade` route.
 *
 * The two resolve to the same screen today — next.config.mjs rewrites
 * `app.kaleidofi.xyz/` to `/trade`, which then 307s to `/trade/agent` — so this
 * is not a behaviour change for a visitor. It is a change of address: the
 * marketing site says kaleidofi.xyz and the product says app.kaleidofi.xyz, and
 * the button that crosses between them should name the destination rather than
 * leave the reader on the marketing origin with an app rendered under it. That
 * also means the app can be served from somewhere else later without touching
 * three call sites here.
 *
 * The bare origin rather than the deeper `/trade/agent`, deliberately: the hop
 * chain in next.config.mjs exists precisely so the front door is one URL anyone
 * can type, and hardcoding today's default mode here would fork that decision
 * across two files.
 *
 * Rendered with a plain `<a>` at each of the three call sites, not `next/link`.
 * `Link` prefetches and hands the navigation to the client router, neither of
 * which applies across an origin — it would fall back to a full page load
 * anyway, having imported the router for nothing.
 */
const APP = "https://app.kaleidofi.xyz";

/**
 * Header anchors.
 *
 * Four, out of the six sections that carry an eyebrow. `#start` and the roadmap
 * are reachable by scrolling and not worth a header slot: a link to "Getting
 * started" competes with the Launch app button two elements to its right for the
 * same click, and nobody navigates to a roadmap first.
 *
 * The labels are the header's own wording, not the eyebrows — "Chains" is the
 * right word in a four-item strip and "Multichain" is the right word above that
 * section's heading. What must not drift is the `href` and the `id` on the
 * section, which is why this list sits directly above them.
 *
 * "Try it" used to lead this list, pointing at the planner in section two. The
 * planner is in the hero now, so that anchor scrolled to the top of the page — a
 * link to where the reader already is.
 */
const ANCHORS = [
  { href: "#can", label: "Capabilities" },
  { href: "#products", label: "Products" },
  { href: "#chains", label: "Chains" },
  { href: "#arch", label: "Architecture" },
];

/**
 * The hero's three figures.
 *
 * ALL THREE ARE DERIVED, and that is the entire reason this row exists where a
 * four-tile protocol strip was cut from. The docblock above records why that strip
 * went: two of its four tiles were zero on real data and the mock-data flag was
 * the only thing hiding it. These are not protocol state — they are the size of
 * the surface, computed from the catalog and the product list at build time, so
 * they cannot be zero, cannot be stale, and cannot be wrong without
 * capabilities.test.ts failing in the gate.
 *
 * The labels disambiguate on purpose. 23 and 29 side by side invite "what is the
 * difference", so the labels answer it: 23 execute, 29 total, the remaining six
 * being reads. A stat a reader has to resolve themselves is a stat that reads as
 * padding.
 */
const STATS: ReadonlyArray<{ value: string; label: string }> = [
  { value: String(EXECUTE_COUNT), label: "actions it executes" },
  { value: String(ALL_TOOLS.length), label: "tools in the catalog" },
  { value: String(PRODUCTS.length), label: "products underneath" },
];

/**
 * The getting-started sequence.
 *
 * WHAT THIS REPLACED, AND WHY IT IS THE LARGEST OMISSION THIS PAGE HAD. The slot
 * held three cards called "Read locally", "Price it, then argue with it" and "You
 * sign" — the three internal stages of plan construction, under the heading "How a
 * plan gets built". Accurate, and answering a question nobody on a landing page
 * asked. A visitor at this point in the page wants to know what *they* do, and the
 * production page has had a Connect/Deploy/Earn block for exactly that reason
 * while this one had nothing anywhere: the page went from the product straight into
 * internals and never came back out to the reader.
 *
 * So the stages become the thing a person does, in their order, with the machinery
 * kept as the second clause rather than the subject. "Most sentences never reach a
 * model" is the local-first grammar; the plan-time audit is what "checked" is. The
 * architecture section is where those get named as architecture.
 *
 * Three, and never four. The value of this shape is that it is short enough to read
 * without deciding to.
 */
const STEPS: ReadonlyArray<{ n: string; title: string; body: string }> = [
  {
    n: "01",
    title: "Connect",
    body: "Any EVM wallet. Read-only until you sign something — there is no account and no deposit.",
  },
  {
    n: "02",
    title: "Ask",
    body: "Type what you want in one sentence. Most of them never reach a model.",
  },
  {
    n: "03",
    title: "Sign",
    body: "Every transaction in the plan, priced and checked, in your wallet and your order.",
  },
];

/**
 * `#chains` — the five chains the products open on, in display order.
 *
 * These are the `tradable: true` mainnets in constants/chains.ts, and the same
 * five the `chains` FAQ topic names, so the page and the agent cannot disagree
 * about where a swap is possible. Everything else in the registry — Polygon,
 * Arbitrum, Hyperliquid, Abstract — is balance reading only, which is what the
 * side card beside this list says.
 *
 * `note` describes what each chain *is*, not where it sits in a deploy queue.
 * It used to read "first", "queued", "queued", "queued", "last": a rollout
 * tracker, false the day the queue drains, and the kind of thing rule 3 at the
 * top of this file exists to keep off the page. The order still carries the
 * priority; the words no longer date.
 *
 * `iconId` is `ChainMeta.iconId` from constants/chains.ts, and it is the real
 * mark. THIS USED TO BE A HAND-TYPED HEX. Each row drew an 8px dot filled with a
 * colour copied off each chain's brand guide — #5546ff, #0052ff, #00c805,
 * #f0b90b, #627eea — on the reasoning that <ChainIcon> would pull twelve icon
 * modules onto the front door to decorate a list whose content is the names.
 *
 * The module count was true and the conclusion was wrong. All five of these
 * chains have a real vector mark that this app already ships and already draws in
 * the nav and the network list, so the dot was a worse copy of an asset we own —
 * five approximations maintained by hand, in the one section whose whole subject
 * is *which chains*. The twelve modules are small static SVG components, not the
 * ~2,200-thunk dynamic map ChainIcon.tsx exists to avoid, and the products
 * section next door now draws real token marks for the same reason.
 *
 * `.chainMark` survives as ChainIcon's `fallback`, now a neutral dot rather than
 * a brand colour: a sixth chain added here without an icon in ChainIcon.tsx gets
 * a grey dot, which reads as missing art rather than as that chain's colour.
 */
const ROLLOUT: ReadonlyArray<{ name: string; note: string; iconId: string }> = [
  { name: "Arc", note: "Circle's stablecoin L1", iconId: "arc" },
  { name: "Base", note: "Coinbase's L2", iconId: "base" },
  {
    name: "Robinhood Chain",
    note: "Robinhood's own chain",
    iconId: "robinhood",
  },
  { name: "BNB Smart Chain", note: "BNB's L1", iconId: "binance-smart-chain" },
  { name: "Ethereum", note: "the L1 itself", iconId: "ethereum" },
];

/**
 * `#arch` — architecture, six cards, one line each.
 *
 * Extracted to data rather than left as markup because the bodies are now the
 * same shape as every other card on the page, and six inline <article>s of prose
 * was what made this section read as an essay. The one exception carries a link,
 * so it keeps its own markup below.
 */
const ARCH: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Diamond Standard, EIP-2535",
    body: "One address, independent facets. The same core deploys unchanged across EVM chains.",
  },
  {
    title: "Non-custodial, always",
    body: "No account, no deposit. The plan you see is the calldata that sends.",
  },
  {
    /* "Protocol actions only" is the scope, stated precisely. A mandate gates
       calls into the diamond; a wallet-to-wallet send never enters it. Do not
       widen this to "what an agent may do". */
    title: "Mandates, if you want them",
    body: "Per-action and daily caps, a health floor, a 30-day expiry. Protocol actions only.",
  },
  {
    title: "Local-first, by design",
    body: "Parsing, pricing and plan building are deterministic code, not model output.",
  },
  {
    title: "Security, stated plainly",
    body: "Stablecoin contracts reviewed and critical findings fixed. Not a completed third-party audit.",
  },
];

/**
 * The roadmap: four dated milestones across one rail.
 *
 * THIS IS A PROJECT ROADMAP, NOT A CHANGELOG, and the difference is the whole
 * reason it was rewritten. It used to be three columns headed Live / Next /
 * Later, each holding a line of features — which is a backlog with the tickets
 * grouped by how soon they land. What a reader opens a protocol's roadmap for is
 * the four events that decide whether to be early: when the contracts go to
 * mainnet, when the token exists, what happens to points when it does, and where
 * it trades afterwards. None of those four were on the page at all.
 *
 * THE DATES ARE THE PROJECT'S OWN PLAN, not an estimate derived from here:
 * mainnet in September 2026, TGE by the end of the same month. Everything else
 * is placed relative to those two, and nothing carries a date that was not
 * stated — which is why phase four is a quarter rather than a month. Do not
 * sharpen "Q4 2026" into a date to make the section look more confident.
 *
 * RULE 3 AT THE TOP OF THIS FILE DOES NOT FORBID THIS SECTION — read the two
 * together before deleting a milestone. What rule 3 bans is apologetic
 * build-state prose addressed to a reader who arrives after release: a hero chip
 * about redeploys, a footer disclaimer, "nothing is deployed yet". A dated
 * schedule of what ships when is the opposite of that. It is the standard
 * artifact every protocol publishes, it is what was asked for here, and a reader
 * in October reads phase two as history rather than as an excuse. The one thing
 * to keep out is commentary *about* the schedule — no "targets, not promises"
 * line, no asterisk. Move a date or drop a milestone instead.
 *
 * WHERE EACH ITEM COMES FROM, because a roadmap is the easiest place on a page
 * to write something nobody has committed to:
 *
 *   - Phase 1 is the shipped surface, and it is the same set §3's product rail
 *     and §4's capability cards already argue in detail. Season 0's 300-point
 *     ceiling is `20260818000000_season0_participation_seed.sql`.
 *   - "Third-party audit" is a milestone precisely because §6's security card
 *     says the opposite is true today — "reviewed and critical findings fixed.
 *     Not a completed third-party audit." The two must keep agreeing; if the
 *     audit lands, both change together.
 *   - "the five rollout chains" is §5's own list and count. Do not restate the
 *     chain names here — that section is thirty lines up and owns them.
 *   - Signed bridging is the honest half of §5's right-hand card: the routes and
 *     fees really are live from Relay and LI.FI, and the signature is what is
 *     missing.
 *   - The freeze, the published table, the dispute window and pro-rata-on-point-
 *     share are docs/points-system.md §6 verbatim in substance. Season 2 past
 *     TGE is its §9. The wording is deliberately mechanism-only — what happens
 *     to accrual — with no supply figure and no multiplier, because that doc
 *     leaves both open and a front door is a bad place to guess one.
 *
 * KEEP EACH ITEM UNDER ABOUT 65 CHARACTERS. These render as four side-by-side
 * columns about 275px wide at 14px, so ten more characters is another wrapped
 * line and a column that outgrows its neighbours. The dispute window used to
 * ride on the end of the freeze line and took that one item to five lines; it
 * travels with the allocation now, which is where it belongs in sequence anyway.
 *
 * WHAT IS DELIBERATELY ABSENT. No governance or DAO milestone: there is no
 * governor and no timelock in smart-contract/contracts, only `OwnershipFacet`,
 * so shipping one on the roadmap would be the first invented thing on the page.
 * No named exchange, for the same reason — "centralised exchange listings" is
 * the commitment, and a logo wall would be a claim about somebody else's
 * decision. No TVL or supply target: rule 4's figure test applies to a future
 * number too.
 */
const ROADMAP: ReadonlyArray<{
  /** Uppercase label above the milestone. A month, a quarter, or "Shipped". */
  when: string;
  /** The event. One or two words — it is the thing being scanned for. */
  title: string;
  /** One line on what the milestone means. Rule 4: if it needs two, it is wrong. */
  lead: string;
  /** Colours the node and the date. `now` is the September window. */
  tone: "done" | "now" | "next";
  items: readonly string[];
}> = [
  {
    when: "Shipped",
    title: "The full stack",
    lead: "Four markets, and an agent with the tools to act on all of them.",
    tone: "done",
    items: [
      "V3 DEX, peer-to-peer lending, kfUSD and the kafUSD vault, liquid staking",
      `Luca: provider-agnostic reasoning, real read tools, ${EXECUTE_COUNT} execute tools, a local-first grammar`,
      "Bounded on-chain agent mandates with caps, a health floor and an expiry",
      "Season 0 settled — participation credit, capped at 300 points",
    ],
  },
  {
    when: "September 2026",
    title: "Mainnet",
    lead: "Every market opens for real money.",
    tone: "now",
    items: [
      "Third-party audit",
      "Protocol deployed across the five rollout chains",
      "Signed bridging — the routes and the fees are already live",
      "Points Season 1 opens: server-computed, receipt-verified, time-weighted",
    ],
  },
  {
    when: "Late September 2026",
    title: "TGE",
    lead: "KLD ships, and points become an allocation.",
    tone: "now",
    items: [
      "KLD token generation event",
      "Accrual frozen at a stated block, the full point table published",
      "Allocation pro-rata on point share, after a dispute window",
      "Initial KLD liquidity in Kaleido's own V3 pools",
    ],
  },
  {
    when: "Q4 2026",
    title: "Listings",
    lead: "KLD where the volume already is.",
    tone: "next",
    items: [
      "Centralised exchange listings",
      "Season 2 opens — the points program continues past TGE",
      "The agentic mobile interface",
    ],
  },
];

/**
 * Rebuild the static page once a day.
 *
 * Two of the capability traces carry a computed date — `borrow` and `lend` turn
 * their `days` argument into a maturity ("At 7.5% until Sep 18, 2026"), because
 * build.ts derives it from the moment the plan is built. Prerendered once and
 * never revalidated, those dates would be however old the deployment is, and a
 * maturity in the past is the kind of small wrongness that makes a reader
 * distrust the numbers next to it.
 *
 * A day rather than an hour: the traces are the only time-dependent thing on the
 * page, and their staleness budget is "not visibly in the past", not "to the
 * minute". Everything else here is static text, and the two live surfaces — the
 * planner and the chart — are client components that fetch on mount, so this
 * interval does not gate them.
 */
export const revalidate = 86400;

export default async function LandingPage() {
  /* Built on the server, once per revalidation. This pulls ethers and the intent
     registry, which is exactly why it happens here and not in the client
     component that renders it. */
  const capabilityGroups = await getCapabilityTraces();

  return (
    <>
      {/* The header is this group's own, not <Nav>. Nav reads the connected
          wallet and the notification context; a public page has neither, and
          importing it is what would drag the wallet stack onto `/`. */}
      <header className={s.header}>
        <Brand />

        <nav className={s.anchors}>
          {ANCHORS.map((a) => (
            <a key={a.href} href={a.href} className={s.anchor}>
              {a.label}
            </a>
          ))}
        </nav>

        <div className={s.headerRight}>
          {/* Our own docs site, not the GitBook the production nav points at.
              Both are real; this one is built from this repository, so it cannot
              describe a version of the product that is not the one being shipped
              from here. */}
          <Link href={DOCS} className={s.headerDocs}>
            Docs
          </Link>
          <ThemeToggle />
          <a href={APP} className={s.launch}>
            Launch app
          </a>
        </div>
      </header>

      <main className={s.page}>
        {/* ---- 1. Hero -------------------------------------------------
            TWO COLUMNS, WHICH IS THE CHANGE THIS REVISION IS ABOUT. It was a
            single left-aligned stack: headline, then lede, then buttons, then
            the planner — four blocks one under another, nothing beside
            anything, and no visual anchor at eye level. That vertical stacking,
            more than any styling, is what made the page read as generated. The
            production landing page composes its hero instead: copy on the left,
            an artefact framed on the right, three figures under the buttons.
            This is that composition with the artefact swapped.

            The swap is the point rather than a compromise. Their frame holds a
            fake terminal — six authored strings played back on delays. This
            holds `LivePlanner`, which runs the product's real parser on
            whatever a visitor types. They built the right frame around the
            wrong thing; this page had the right thing and no frame on it.

            No chrome is added around the planner here, deliberately: it already
            composes k-glass, which is the app's own panel material, so it reads
            as a live surface. The screenshot directly below gets window chrome
            instead. That is the distinction — a frame means "picture of the
            app", no frame means "the app" — and it is what stops two panels in
            a row reading as the same thing twice. */}
        <section className={s.hero}>
          {/* The dotted dome across the foot of the hero. Artwork with no
              content, so it says nothing to a screen reader and takes no clicks
              aimed at the CTAs — both handled inside the component.

              It is a client component, and the only one on this page besides the
              planner and the theme toggle, because the dots are animated
              individually on a canvas. The still SVG behind that canvas is what
              paints before hydration, so the hero never arrives without its
              artwork; HeroArc.tsx has the reasoning for both halves.

              A child of the section, not of `.heroCopy`, because it spans both
              columns — it was inside the copy column with its crown above the h1,
              which put a shape behind the headline rather than a horizon under the
              whole composition. It is absolutely positioned against `.hero`, so
              being the first child of a two-column grid costs it no column and the
              grid no row, and `.hero`'s `isolation: isolate` is what keeps its
              negative z-index from escaping the section.

              First in source order so that matches paint order. Nothing depends
              on it — z-index: -1 does the work — but a decorative layer declared
              after the text it sits behind is the kind of thing that gets read as
              a mistake and "fixed". */}
          <HeroArc />

          <div className={s.heroCopy}>
            {/* Just the name. This read "Kaleido DeFi-OS", which was the right
                eyebrow over a headline that named a behaviour — but the h1 below
                now spells out what "DeFi-OS" abbreviates, and the pair put
                "operating system" on screen twice inside 40 vertical pixels. The
                indexed <title> still carries the full string, so nothing is lost
                where it is actually read; see the metadata docblock. */}
            <p className={s.eyebrow}>Kaleido</p>

            {/* A category, not a behaviour. Two versions came before this one:
                "Tell it what you want. / It builds the plan.", which was two
                sentences of dialogue captioning the planner rather than claiming
                anything, and "DeFi that takes instructions", which claimed a
                behaviour — true, and still a feature sentence on a page whose
                competitors each name the category they intend to own.

                Five words and 39 characters against a 626px measure — the hero
                grid is `minmax(0, 1fr) minmax(0, 500px)` with a 34px gap inside
                a 1160px content box — set at 52px with a 1.08 line-height. The
                break lands after "for" or after "system", so this is two lines
                at desktop like the headline it replaced, and three only if the
                column narrows. Whichever it is, do not buy a line back by
                cutting it to "AI operating system for DeFi": "onchain finance"
                is the larger claim, and it is the one the five products below
                actually support.

                "AI" is set as the initialism it is, not "Ai". At 52px in a serif
                display face a lowercase "i" beside a capital "A" reads as a
                typo rather than as styling, and this is the largest text on the
                site.

                It opens on "AI" rather than on "The", which drops the definite
                article a category claim would normally carry. That is a trade
                and it is the right one here: "AI operating system" is the claim
                worth making first, and the eyebrow above already establishes
                whose it is.

                The indexed <title> keeps "The Autonomous Financial Layer"; see
                the metadata docblock for why the two are allowed to differ. */}
            <h1 className={`${s.h1} k-display`}>
              AI operating system for onchain finance
            </h1>

            {/* The list is the argument. A headline claiming a category has to be
                paid for in the next breath, and the payment is naming what is
                underneath instead of gesturing at it: the middle beat here used
                to be "a priced plan across the whole stack", which is a phrase a
                reader has no reason to believe on sight.

                Those five nouns are PRODUCTS — Trade, Liquidity, Borrow, Stake,
                Stable — so this line and `PRODUCTS.length` in the stat row below
                are two renderings of one fact. Add a sixth product and this
                sentence is wrong. The order is by rhythm rather than by the
                array; the set is what has to match.

                "Ask in plain English" is gone and not missed: LivePlanner sits
                immediately to the right running the real parser, so the claim is
                demonstrated one keystroke away rather than asserted here.

                THE OLD THIRD BEAT IS GONE ON PURPOSE. It was "Nothing moves
                until you sign." — a guardrail, and the one framing this product
                is explicitly not sold on, because it describes what the agent
                cannot do in the one place on the page reserved for what the stack
                can. It is not dropped from the page, only from the hero: signing
                is step 3 of STEPS below, where a reader asking "what do I do"
                meets it in sequence. Do not restore it here. */}
            <p className={s.lede}>
              Swaps, lending, liquidity, staking and a native stablecoin — one
              instruction, priced and routed across all of it.
            </p>

            <div className={s.ctas}>
              <a href={APP} className={s.primary}>
                Launch app
              </a>
              {/* "See the stack" pointed at #stack, one screen down. A docs
                  link is the second thing a reader of a DeFi front door
                  actually wants, and it is the pairing the production page
                  uses. */}
              <Link href={DOCS} className={s.secondary}>
                Read the docs
              </Link>
            </div>

            <dl className={s.stats}>
              {STATS.map((st) => (
                <div key={st.label} className={s.stat}>
                  <dt className={s.statValue}>{st.value}</dt>
                  <dd className={s.statLabel}>{st.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* No heading above this, and that is deliberate. It carried an h2
              ("This is the real parser. Type something.") and a forty-word
              intro explaining that it was not a mock — words spent asserting
              what the reader can verify in one keystroke. The component's own
              empty state says the same thing in a line. */}
          <div className={s.planner}>
            <LivePlanner />
          </div>
        </section>

        {/* ---- 2. What it can do -------------------------------------- */}
        <section id="can" className={s.section}>
          <div className={s.head}>
            <p className={s.eyebrow}>Capabilities</p>
            <h2 className={`${s.h2} k-display`}>
              {EXECUTE_COUNT} actions it can execute
            </h2>
            {/* The second number is here because the grid shows both sets and a
                reader counting cards gets 29, not EXECUTE_COUNT. Both derived
                from capabilities.ts, so neither can drift from the data. */}
            <p className={s.sub}>
              Every one of them plays here in order — the sentence going in,
              Luca&rsquo;s reply, and each step it plans, from the same builder
              the app signs. Pick a card to hold one. The {READS.tools.length}{" "}
              read tools are listed with them; those only look.
            </p>
          </div>

          {/* All 29 tools as cards beside one animated turn, and the turn walks
              the cards in reading order by itself — a visitor who never clicks
              still sees the whole surface, which is what the section claims.
              Each turn is replayed rather than authored: the prompt goes through
              parseCommand and buildIntents in _components/traces.ts, so Luca's
              line is the builder's own summary and the steps are renderIntent's
              own labels. Why the cards are an index rather than the content, why
              the rotation stops the moment someone picks for themselves, and why
              not a live product surface per group, is the docblock in
              CapabilityTabs.tsx; how the clock runs without shoving the page
              down is the one in TracePlayer.tsx.

              ToolRibbon used to sit under this as a second, flat copy of the
              same inventory. The card grid is that inventory now, so the ribbon
              said everything twice; the component is still on disk. */}
          <CapabilityTabs groups={capabilityGroups} />
        </section>

        {/* ---- 3. The products underneath -----------------------------
            A rail of five names beside one panel of detail, which is the shape
            the production page uses for its module grid and the best-working
            component on it. What was here was the live price chart in one column
            and the five names as a flat row list in the other: the chart is a
            *trade* surface, so pairing it with all five implied it belonged to
            all five, and a row list gives every product the same six words.
            The chart is inside the Trade entry now, where it is about the thing
            being described. ProductRail.tsx has the full reasoning. */}
        <section id="products" className={s.section}>
          <div className={s.head}>
            <p className={s.eyebrow}>The stack</p>
            {/* A numeral rather than "Five", for the reason `#can`'s heading is
                a numeral: it is derived from PRODUCTS, so a sixth product
                corrects the heading instead of quietly falsifying it. */}
            <h2 className={`${s.h2} k-display`}>
              {PRODUCTS.length} products under one agent
            </h2>
            <p className={s.sub}>
              All five built here. An agent with no protocol under it is a chat
              window.
            </p>
          </div>

          <ProductRail />
        </section>

        {/* ---- 4. Getting started -------------------------------------
            The section this page did not have. See the STEPS docblock: the slot
            held the three internal stages of plan construction, which explains
            the machine to an engineer and never tells a visitor what to do. */}
        <section id="start" className={s.section}>
          <div className={s.head}>
            <p className={s.eyebrow}>Getting started</p>
            <h2 className={`${s.h2} k-display`}>Connect. Ask. Sign.</h2>
          </div>

          <ol className={s.steps}>
            {STEPS.map((st) => (
              <li key={st.n} className={s.stepCard}>
                <span className={s.stepNum}>{st.n}</span>
                <h3 className={s.cardTitle}>{st.title}</h3>
                <p className={s.cardBody}>{st.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---- 5. Multichain, scoped ---------------------------------- */}
        <section id="chains" className={s.section}>
          <div className={s.head}>
            <p className={s.eyebrow}>Multichain</p>
            {/* "Multichain, and exactly how far it goes" put the hedge in the
                heading. The scope is still stated in full — it is the sub and
                the whole right-hand card — but a heading is not where a page
                qualifies itself. */}
            <h2 className={`${s.h2} k-display`}>
              Wherever your money already is
            </h2>
            <p className={s.sub}>
              Swaps, loans, liquidity and kfUSD open on five chains, in this
              order.
            </p>
          </div>

          <div className={s.chainWrap}>
            <ol className={s.chainList}>
              {ROLLOUT.map((c, i) => (
                <li key={c.name} className={s.chainRow}>
                  <span className={s.chainIdx}>{i + 1}</span>
                  <ChainIcon
                    id={c.iconId}
                    size={20}
                    className={s.chainIcon}
                    fallback={<i className={s.chainMark} aria-hidden="true" />}
                  />
                  <span className={s.chainName}>{c.name}</span>
                  <span className={s.chainNote}>{c.note}</span>
                </li>
              ))}
            </ol>

            <div className={s.chainSide}>
              <h3 className={s.cardTitle}>Every registered chain</h3>
              <p className={s.cardBody}>
                Balance reading, Polygon and Arbitrum and Hyperliquid and
                Abstract included. Viewing, not trading.
              </p>
              <h3 className={s.cardTitle}>Bridging: quotes, not execution</h3>
              <p className={s.cardBody}>
                Live routes and fees from Relay and LI.FI. You are handed the
                route; Kaleido does not sign it.
              </p>
            </div>
          </div>
        </section>

        {/* ---- 6. Architecture ---------------------------------------- */}
        <section id="arch" className={s.section}>
          <div className={s.head}>
            <p className={s.eyebrow}>Architecture</p>
            {/* "Underneath" was a preposition doing a heading's job, and it
                pointed at the section above it — the products are underneath
                the agent, this is underneath all of it. The claim worth making
                here is the one card six of six carries: it is all readable. */}
            <h2 className={`${s.h2} k-display`}>Built in the open</h2>
          </div>

          <div className={s.grid3}>
            {ARCH.map((a) => (
              <article key={a.title} className={s.card}>
                <h3 className={s.cardTitle}>{a.title}</h3>
                <p className={s.cardBody}>{a.body}</p>
              </article>
            ))}

            {/* Not in ARCH because it carries a link, and a body string with an
                anchor in it would have to be either HTML or a second field. */}
            <article className={s.card}>
              <h3 className={s.cardTitle}>Open source</h3>
              <p className={s.cardBody}>
                Contracts, interface and agent in one public repository.{" "}
                <a className={s.inline} href={REPO}>
                  Read it
                </a>
                .
              </p>
            </article>
          </div>
        </section>

        {/* ---- 7. Roadmap --------------------------------------------- */}
        <section className={s.section}>
          {/* No sub. The heading states both dates, which is the whole intro a
              schedule needs — and a sub here would be where a hedge about
              targets got written. The milestone list is the content. */}
          <div className={s.head}>
            <p className={s.eyebrow}>Roadmap</p>
            <h2 className={`${s.h2} k-display`}>
              Mainnet in September, TGE by month end
            </h2>
          </div>

          {/* An <ol> even though it renders as four columns, because the one
              thing this section means is order — and left-to-right is a
              convention, where markup order is a fact. The three piles headed
              Live / Next / Later that started here were a <div> of <article>s,
              so a reader had to infer the sequence from those three words and a
              screen reader was told nothing at all. */}
          <ol className={s.road}>
            {ROADMAP.map((r) => (
              <li key={r.title} className={`${s.mile} ${s[r.tone]}`}>
                {/* Absolutely positioned at the top-left of the column, with
                    the rail crossing the gutter to the next one — the 20px of
                    `padding-top` on `.mile` is what holds that band open, since
                    the dot itself contributes no height. `aria-hidden` because
                    the date and the list order already carry every bit of state
                    the dot's colour encodes. */}
                <span className={s.mileDot} aria-hidden="true" />
                <div>
                  <p className={s.mileWhen}>{r.when}</p>
                  <h3 className={s.mileTitle}>{r.title}</h3>
                  <p className={s.mileLead}>{r.lead}</p>
                  <ul className={s.bullets}>
                    {r.items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ---- 8. Closing --------------------------------------------- */}
        {/* THE SECTION THIS PAGE DID NOT HAVE AT ALL, and the plainest thing
            wrong with it: it ended on a roadmap and then a footer, so the last
            thing a convinced reader saw was a list of what is not built yet and
            a column of links. Every page it competes with closes by asking for
            the click. There is one button, because a closing CTA with two is a
            closing CTA that could not decide.

            Centred, and the only centred block on the page — the rhythm break
            is what makes it read as an ending rather than a tenth section. It
            sits in one glass panel, which is the other half of that: bare text
            on the page background read as the page having run out. It is also
            text only — the screenshot that was going to sit here is under the
            hero instead, where it is doing more work.

            The heading is an instruction rather than a benefit, and it is the
            same instruction the hero opens with, closed. */}
        <section className={s.closing}>
          <h2 className={`${s.closeH} k-display`}>Start with one sentence.</h2>
          <p className={s.closeSub}>
            Swaps, loans, liquidity, staking and stablecoins, from a single
            instruction.
          </p>
          <a href={APP} className={s.primary}>
            Launch app
          </a>
        </section>

        {/* ---- 9. Footer --------------------------------------------- */}
        <footer className={s.footer}>
          <div className={s.footBrand}>
            {/* Not a link: this footer only ever renders at the bottom of `/`, so
                a wordmark pointing at `/` is a link to the page you are on. */}
            <Brand href={null} />
            <p className={s.footLine}>
              Deploy, stake, and reason. A DeFi operating system for people who
              would rather state the outcome than assemble it.
            </p>
          </div>

          <nav className={s.footCols}>
            <div>
              <h4 className={s.footHead}>Product</h4>
              <Link href="/trade">Trade</Link>
              <Link href="/pool">Liquidity</Link>
              <Link href="/borrow">Borrow</Link>
              <Link href="/stake">Stake</Link>
              <Link href="/stable">Stable</Link>
            </div>
            <div>
              <h4 className={s.footHead}>Agent</h4>
              <Link href="/trade/agent">Luca</Link>
              <Link href="/portfolio">Portfolio</Link>
              <Link href="/leaderboard">Leaderboard</Link>
            </div>
            <div>
              <h4 className={s.footHead}>Build</h4>
              <a href={REPO}>GitHub</a>
              <Link href={DOCS}>Docs</Link>
              <Link href={`${DOCS}/deployments`}>Deployment map</Link>
            </div>
          </nav>
        </footer>
      </main>
    </>
  );
}
