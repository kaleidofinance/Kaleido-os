import Link from "next/link";

import { DOC_GROUPS, REPO, REPO_TREE } from "./docs";
import { loadDoc } from "./docsSource";
import s from "./docs.module.css";

/**
 * The docs index.
 *
 * AUTHORED, NOT `docs/README.md`. That file is the obvious candidate and it is the
 * wrong one: it is a GitHub file-browser index — emoji section headings, a link
 * farm across nineteen files including the ones deliberately not published,
 * a "Contributing / submit a pull request" section and a "Document Conventions"
 * table. Rendered as a web page it would advertise eighteen documents that are not
 * on this site and describe how to edit markdown.
 *
 * So this page is written, and everything it claims comes from the manifest — the
 * groups, the titles, the blurbs, and a section count read off each document's
 * rendered headings. The card grid cannot describe a page that does not exist,
 * and it cannot go stale against the sidebar, because both are the same array.
 */
export default function DocsIndex() {
  const groups = DOC_GROUPS.map((g) => ({
    label: g.label,
    entries: g.entries.map((e) => ({
      ...e,
      sections: loadDoc(e.slug)?.headings.length ?? 0,
    })),
  }));

  return (
    <article className={s.wide}>
      <header className={s.indexHead}>
        <p className={s.eyebrow}>Documentation</p>
        <h1 className={s.indexTitle}>How Kaleido works</h1>
        <p className={s.lede}>
          Every product in one place, described by what it actually does:
          swapping and providing liquidity, a peer-to-peer lending book, a
          yield-bearing stablecoin, staking, and the agent that can drive all of
          it from a sentence. Then the parts underneath — the contracts, the
          oracle, every fee, and what has to exist on a chain before Kaleido can
          run there. Then KLD itself: one billion tokens, eight buckets, and the
          dates the rest of it is measured against. Each page is a document in
          the protocol repository and links to its source.
        </p>
      </header>

      {groups.map((g) => (
        <section key={g.label} className={s.indexSection}>
          <h2 className={s.indexSectionTitle}>{g.label}</h2>
          <div className={s.cards}>
            {g.entries.map((e) => (
              <Link key={e.slug} href={`/docs/${e.slug}`} className={s.card}>
                <span className={s.cardGroup}>{g.label}</span>
                <span className={s.cardTitle}>{e.title}</span>
                <p className={s.cardBlurb}>{e.blurb}</p>
                <span className={s.cardMeta}>
                  {e.sections} section{e.sections === 1 ? "" : "s"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section className={s.indexSection}>
        <h2 className={s.indexSectionTitle}>Reading the source</h2>
        <p className={s.indexSectionBody}>
          These pages are reference documents, not the contracts themselves. The
          Solidity, the deploy scripts and the tests are in the repository, and
          anything on this site can be corrected there — each page links to the
          file it was built from.
        </p>
        <div className={s.links}>
          <a
            className={s.linkOut}
            href={`${REPO_TREE}/smart-contract/contracts`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Contracts
          </a>
          <a
            className={s.linkOut}
            href={`${REPO_TREE}/docs`}
            target="_blank"
            rel="noopener noreferrer"
          >
            All documents
          </a>
          <a
            className={s.linkOut}
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
          >
            Repository
          </a>
          <Link className={s.linkOut} href="/trade">
            Open the app
          </Link>
        </div>
      </section>
    </article>
  );
}
