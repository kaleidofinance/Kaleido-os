import Link from "next/link";
import s from "./Brand.module.css";

/**
 * The Kaleidofi wordmark.
 *
 * WHY THIS IS ITS OWN COMPONENT. The mark was written twice before the docs site
 * existed — once in the landing header and footer
 * (src/app/(marketing)/page.tsx), once in the app's nav
 * (src/components/v2/Nav.tsx:155) — and the second copy exists on purpose: app
 * chrome must not import from a marketing route group. The docs header would have
 * been a third, and three copies of a logo is how one of them ends up a different
 * size or missing the `fi` after a redesign.
 *
 * So the two inside this route group share this, and Nav keeps its own. Two
 * copies with a reason beats three without one.
 *
 * TWO DETAILS THAT ARE LOAD-BEARING and were both bugs at some point:
 *
 * The whole wordmark sits inside ONE <span> rather than being `Kaleido` plus a
 * sibling `<span>fi</span>`. The row is a flex container with an 8px gap for the
 * mark, and a bare text node next to a <span> is its own flex item — so the two
 * halves of a single word would render 8px apart.
 *
 * `aria-label` is "Kaleidofi", which is what the eye reads. It used to say
 * "Kaleido OS", a fine expansion of the old wordmark and no longer a superset of
 * the visible text; an accessible name that omits the visible label is what
 * breaks voice control ("click Kaleidofi" matching nothing).
 *
 * `href={null}` renders a plain <span> instead of a link, which is what the
 * landing footer wants and had before this extraction. That was deliberate there,
 * not an omission: the footer sits at the bottom of `/`, so a wordmark linking to
 * `/` is a link to the page you are already on — announced by a screen reader as a
 * navigation option that does nothing. The header's copy is a real link because it
 * is reached from `/docs` too.
 */
export default function Brand({ href = "/" }: { href?: string | null }) {
  const inner = (
    <>
      <span className={s.mark} />
      <span>
        Kaleido<span className={s.fi}>fi</span>
      </span>
    </>
  );

  if (href === null) {
    return (
      <span className={s.brand} aria-label="Kaleidofi">
        {inner}
      </span>
    );
  }

  return (
    <Link href={href} className={s.brand} aria-label="Kaleidofi">
      {inner}
    </Link>
  );
}
