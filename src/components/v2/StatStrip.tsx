/**
 * The stat strip shared by the page shells that carry one.
 *
 * Three files had grown a `Stat` component that was identical apart from which
 * CSS-module name it reached for (`s.stat` on the page that has since become
 * /leaderboard, `s.sTile` on the Liquidity and Lending shells), plus a 35-line
 * block of stylesheet that was identical in every declaration. That is the same
 * state `lib/format/figures.ts` was extracted out of, and for the same reason:
 * copies that agree today are copies that drift, and two strips rounding one
 * `/api/market/overview` response differently read to a user as two different
 * numbers.
 *
 * WHAT IS DELIBERATELY NOT FOLDED IN
 *
 * `portfolio/page.tsx`, `stable/layout.tsx` and `stake/page.tsx` also have a
 * `.strip`, but their tiles are written out as markup rather than through a
 * component, and some hold more than a label and a value — Portfolio's
 * collateral tile carries a token list. Rewriting those to fit this shape is a
 * change to what they display, not a deduplication of how, so it is a separate
 * piece of work. Same line `figures.ts` draws around the portfolio formatters.
 */

import type { ReactNode } from "react";

import s from "./StatStrip.module.css";

/**
 * The container. A component rather than an exported class name because the
 * tile dividers are drawn with `:first-child`, which only works if the tiles are
 * the strip's direct children — worth enforcing in one place instead of
 * documenting at each call site.
 */
export function StatStrip({ children }: { children: ReactNode }) {
  return <div className={s.strip}>{children}</div>;
}

export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  /**
   * Pre-formatted, and a string rather than `number | null`. The tile does not
   * decide what an absent figure looks like — `lib/format/figures.ts` does, and
   * its `DASH` is the answer everywhere. A tile that took a nullable number
   * would be a second place for "$0" to creep back in.
   */
  value: string;
  /** Why the figure is missing, or what it excludes. Null renders nothing. */
  note?: string | null;
}) {
  return (
    <div className={s.tile}>
      <span className={s.label}>{label}</span>
      <span className={`${s.value} tabular`}>{value}</span>
      {note ? <span className={s.note}>{note}</span> : null}
    </div>
  );
}
