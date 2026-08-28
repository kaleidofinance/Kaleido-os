import type { ReactNode } from "react";
import type { Metadata } from "next";

import Brand from "../_components/Brand";
import ThemeToggle from "@/components/v2/ThemeToggle";
import DocsSidebar, { type SidebarHeading } from "./_components/DocsSidebar";
import { ALL_DOCS, REPO_TREE } from "./docs";
import { loadDoc } from "./docsSource";
import s from "./docs.module.css";

export const metadata: Metadata = {
  title: { default: "Documentation", template: "%s · Kaleidofi docs" },
  description:
    "How Kaleido works: swaps, concentrated liquidity, peer-to-peer lending, the kfUSD stablecoin, staking, the KLD token and its unlock schedule, and the agent that can drive all of it — built from the protocol's own repository.",
};

/**
 * The docs shell: header, sidebar, and the slot the article renders into.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LAYOUT READS EVERY DOCUMENT
 * ---------------------------------------------------------------------------
 * The sidebar's filter reaches section level, so it needs every page's headings —
 * not just the current one's. Those live in the markdown, so somebody has to read
 * all fifteen files, and the only two places that could happen are here or in the
 * client.
 *
 * It happens here. `loadDoc` is `readFileSync`, this is a server component, and
 * every page under it is statically generated — so the fifteen reads happen once
 * during `next build` and produce the heading index as part of the HTML. The
 * alternative, fetching an index at runtime, would mean a request, a loading state
 * and a spinner on a static documentation site.
 *
 * The layout is shared across all sixteen routes, so React renders it once per
 * page and Next dedupes nothing here — fifteen small `readFileSync` calls per page
 * at build time is 240 reads of about 5 KB each. Still not worth a cache; if the
 * set grows by another order of magnitude, memoising `loadDoc` is the fix rather
 * than moving the index into the client.
 *
 * ---------------------------------------------------------------------------
 * THE HEADER IS THIS ROUTE'S OWN
 * ---------------------------------------------------------------------------
 * Not the landing page's. That one carries in-page anchors — #capabilities,
 * #products, #roadmap — which resolve to nothing on a /docs URL, and this one
 * needs a link back to the landing page and one to the repository that it has no
 * use for. What they share is <Brand>, extracted for exactly this reason.
 *
 * No <Nav> either, for the reason (marketing)/layout.tsx gives: Nav reads the
 * connected wallet and the notification context, and importing it is what would
 * drag the wallet stack onto a public page. Nothing under this layout calls a
 * wallet hook, so /docs renders identically with no extension installed.
 */
export default function DocsLayout({ children }: { children: ReactNode }) {
  const headings: Record<string, SidebarHeading[]> = {};
  for (const d of ALL_DOCS) {
    const loaded = loadDoc(d.slug);
    headings[d.slug] = (loaded?.headings ?? []).map((h) => ({
      id: h.id,
      text: h.text,
    }));
  }

  return (
    <>
      <header className={s.header}>
        <Brand />
        {/* Points at /docs, not at the current page — it is the breadcrumb's
            second level, and the wordmark beside it already goes home. */}
        <a href="/docs" className={s.headerCrumb}>
          <span className={s.headerSlash} aria-hidden="true">
            /
          </span>
          Docs
        </a>

        <div className={s.headerRight}>
          <a href="/" className={s.headerLink}>
            Overview
          </a>
          <a
            href={`${REPO_TREE}/docs`}
            className={s.headerLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <ThemeToggle />
          <a href="/trade" className={s.launch}>
            Launch app
          </a>
        </div>
      </header>

      <div className={s.shell}>
        <DocsSidebar headings={headings} />
        {children}
      </div>
    </>
  );
}
