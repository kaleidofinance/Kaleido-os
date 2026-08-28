import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import DocBody from "../_components/DocBody";
import DocsToc from "../_components/DocsToc";
import { ALL_DOCS, DOC_GROUPS, REPO_BLOB } from "../docs";
import { loadDoc } from "../docsSource";
import s from "../docs.module.css";

/**
 * One documentation page.
 *
 * ---------------------------------------------------------------------------
 * STATIC AT BUILD TIME, WHICH IS WHAT MAKES READING `docs/` SAFE
 * ---------------------------------------------------------------------------
 * `generateStaticParams` enumerates the manifest, so all fifteen pages are HTML in
 * `.next` before anything is served. That is not an optimisation — it is the
 * reason this route can read markdown from `docs/`, a directory outside `src/`
 * that Next's file tracing has no reason to include in a deployment bundle. A
 * dynamically rendered version of this page would work in `next dev` and throw
 * ENOENT in production, which is the worst shape a bug can have.
 *
 * `dynamicParams = false` closes the other half of it: without it, a request for
 * `/docs/security-findings` would be treated as a page that simply has not been
 * generated yet and rendered on demand. `loadDoc` returns null for an unknown
 * slug so it would 404 either way, but the guarantee should be structural — the
 * set of docs URLs that exist is exactly the set in the manifest, and nothing can
 * be reached by guessing a filename.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return ALL_DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = loadDoc(slug);
  if (!doc) return {};

  /* The document's own H1 for the tab, not the manifest's short sidebar label:
     "Multichain deployment map" is what the page calls itself, and a title that
     disagrees with the visible heading is the kind of thing that shows up in a
     search result and reads as a different page. */
  return {
    title: doc.h1,
    description: doc.entry.blurb,
    alternates: { canonical: `/docs/${doc.entry.slug}` },
  };
}

/** The manifest order, flattened — which is the order the sidebar shows. */
const ORDER = DOC_GROUPS.flatMap((g) =>
  g.entries.map((e) => ({ group: g.label, entry: e })),
);

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = loadDoc(slug);
  if (!doc) notFound();

  const i = ORDER.findIndex((x) => x.entry.slug === slug);
  const prev = i > 0 ? ORDER[i - 1] : null;
  const next = i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null;
  const group = ORDER[i]?.group;

  return (
    <>
      <article className={s.article}>
        <div className={s.body}>
          {group && <p className={s.eyebrow}>{group}</p>}
          <h1 className={s.title}>{doc.h1}</h1>
          <p className={s.lede}>{doc.entry.blurb}</p>

          {/* Provenance. This page is generated from a file in the repository, so
              it says which file and links to it — both because that is the honest
              answer to "where does this come from", and because it is the fastest
              route for anyone who wants to fix a mistake in it. The section count
              is read off the rendered headings rather than estimated. */}
          <p className={s.meta}>
            <span>
              {doc.headings.length} section
              {doc.headings.length === 1 ? "" : "s"}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Source{" "}
              <a
                className={s.metaLink}
                href={`${REPO_BLOB}/${doc.entry.file}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {doc.entry.file}
              </a>
            </span>
          </p>

          <DocBody markdown={doc.markdown} file={doc.entry.file} />

          {(prev || next) && (
            <nav className={s.pager} aria-label="Adjacent pages">
              {prev && (
                <Link href={`/docs/${prev.entry.slug}`} className={s.pagerItem}>
                  <span className={s.pagerDir}>Previous</span>
                  <span className={s.pagerTitle}>{prev.entry.title}</span>
                </Link>
              )}
              {next && (
                <Link href={`/docs/${next.entry.slug}`} className={s.pagerNext}>
                  <span className={s.pagerDir}>Next</span>
                  <span className={s.pagerTitle}>{next.entry.title}</span>
                </Link>
              )}
            </nav>
          )}
        </div>
      </article>

      {/* The third grid column. Rendered as a sibling of the article rather than
          inside it, because it is a rail of the shell and has to be able to stick
          to the viewport independently of how far the prose has scrolled. */}
      <DocsToc headings={doc.headings} />
    </>
  );
}
