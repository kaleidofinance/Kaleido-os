import type { Heading } from "../docs";
import s from "../docs.module.css";

/**
 * "On this page".
 *
 * A server component and a plain list of anchors — no scroll-spy. That was a
 * deliberate omission rather than an oversight: highlighting the section the
 * reader is currently in needs an IntersectionObserver, which makes this the
 * second client component on the route and buys a decoration. The rail's job is to
 * show the shape of the page and let you jump; it does that as static HTML.
 *
 * The ids come from `scanHeadings` over the *published* markdown, so a section
 * removed by the manifest's `omit` is not listed here — which matters, because in
 * these files the heading text is the part that says the internal thing.
 *
 * H3s are indented and nothing deeper is shown. Four levels in a rail 208px wide
 * is a rail of wrapped fragments.
 */
export default function DocsToc({ headings }: { headings: Heading[] }) {
  if (headings.length < 2) return <aside className={s.toc} />;

  return (
    <aside className={s.toc} aria-label="On this page">
      <p className={s.tocLabel}>On this page</p>
      <ul className={s.tocList}>
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={h.depth === 3 ? s.tocSub : s.tocLink}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
