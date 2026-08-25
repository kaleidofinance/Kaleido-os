"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import { DOC_GROUPS } from "../docs";
import s from "../docs.module.css";

export interface SidebarHeading {
  id: string;
  text: string;
}

/**
 * The docs navigation, and the only client component in this feature.
 *
 * It is client-side for three reasons, all of them state: the collapsible groups,
 * the filter field, and the mobile disclosure. Everything else on /docs — the
 * prose, the contents rail, the index — is server-rendered HTML.
 *
 * It imports `DOC_GROUPS` from `../docs`, which is why that module is not allowed
 * to touch `node:fs`: this import puts the manifest in the browser bundle. The
 * manifest is public information (it is a list of published URLs and their
 * titles), and the `UNPUBLISHED` map beside it — which names the files that are
 * deliberately withheld — is not referenced here, so tree-shaking leaves it out.
 * Nothing in it is secret either, but there is no reason to ship it.
 *
 * ---------------------------------------------------------------------------
 * THE FILTER IS A FILTER, AND IS LABELLED AS ONE
 * ---------------------------------------------------------------------------
 * It matches page titles, blurbs, and heading text. It does not match body prose.
 * That is an honest thing to offer over four pages and it is NOT search, so the
 * placeholder says "Filter pages" — a reader who typed "cooldown", got nothing,
 * and concluded the docs never mention cooldowns would have been misled by a
 * placeholder that said "Search".
 *
 * Headings come in as a prop rather than being read here, because reading them
 * means reading the files, and this component runs in the browser. The layout is a
 * server component; it loads the documents once at build time and passes down the
 * headings, so the filter can reach section level without the client ever
 * touching the filesystem.
 */
export default function DocsSidebar({
  headings,
}: {
  /** slug -> its published headings, supplied by the server layout. */
  headings: Record<string, SidebarHeading[]>;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [navOpen, setNavOpen] = useState(false);

  const q = query.trim().toLowerCase();

  /**
   * The groups as they should be shown, with per-page heading matches.
   *
   * A page survives if its own text matches OR any of its headings do; the
   * matching headings are listed under it so a hit lands on the section rather
   * than on the top of a 9,000-character document. When the query is empty the
   * heading lists are empty too — as permanent navigation, `collateral-flow`
   * alone would put 27 entries in the rail.
   */
  const shown = useMemo(() => {
    return DOC_GROUPS.map((g) => ({
      label: g.label,
      entries: g.entries
        .map((e) => {
          const hs = headings[e.slug] ?? [];
          if (q === "") return { entry: e, matched: [] as SidebarHeading[] };

          const matched = hs.filter((h) => h.text.toLowerCase().includes(q));
          const self =
            e.title.toLowerCase().includes(q) ||
            e.blurb.toLowerCase().includes(q) ||
            g.label.toLowerCase().includes(q);

          if (!self && matched.length === 0) return null;
          return { entry: e, matched };
        })
        .filter(
          (
            x,
          ): x is {
            entry: (typeof g.entries)[number];
            matched: SidebarHeading[];
          } => x !== null,
        ),
    })).filter((g) => g.entries.length > 0);
  }, [q, headings]);

  const total = shown.reduce((n, g) => n + g.entries.length, 0);

  return (
    <nav className={s.sidebar} aria-label="Documentation">
      {/* Only visible below 900px, where the rail becomes a block above the
          article. `aria-expanded` on the button and nothing hidden from the
          accessibility tree that is visible on screen. */}
      <button
        type="button"
        className={s.navToggle}
        onClick={() => setNavOpen((v) => !v)}
        aria-expanded={navOpen}
      >
        <span>Documentation</span>
        <Caret open={navOpen} />
      </button>

      <div className={navOpen ? `${s.navBody} ${s.navBodyOpen}` : s.navBody}>
        <input
          type="search"
          className={s.filter}
          placeholder="Filter pages"
          aria-label="Filter documentation pages and sections"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {total === 0 && (
          <p className={s.empty}>
            Nothing matches “{query.trim()}”. The filter covers page titles and
            section headings.
          </p>
        )}

        {shown.map((g) => {
          /* A filtered result is never collapsed — hiding the thing somebody just
             searched for behind a closed group is the one state this must not
             reach. */
          const open = q !== "" || !collapsed[g.label];
          return (
            <div key={g.label} className={s.group}>
              <button
                type="button"
                className={s.groupLabel}
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [g.label]: !c[g.label] }))
                }
                aria-expanded={open}
              >
                <Caret open={open} />
                {g.label}
              </button>

              {open && (
                <ul className={s.items}>
                  {g.entries.map(({ entry, matched }) => {
                    const href = `/docs/${entry.slug}`;
                    const active = pathname === href;
                    return (
                      <li key={entry.slug}>
                        <Link
                          href={href}
                          className={active ? s.itemActive : s.item}
                          aria-current={active ? "page" : undefined}
                          onClick={() => setNavOpen(false)}
                        >
                          {entry.title}
                        </Link>
                        {matched.length > 0 && (
                          <ul className={s.subItems}>
                            {matched.slice(0, 6).map((h) => (
                              <li key={h.id}>
                                <Link
                                  href={`${href}#${h.id}`}
                                  className={s.subItem}
                                  onClick={() => setNavOpen(false)}
                                >
                                  {h.text}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

/** A chevron, rotated rather than swapped, so the state change can animate. */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? s.caret : `${s.caret} ${s.caretClosed}`}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 3.5 5 6.5 8 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
