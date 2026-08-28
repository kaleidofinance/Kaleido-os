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
 *
 * A TILE IS A LABEL AND A FIGURE. NOTHING ELSE.
 *
 * `Stat` took a third prop, `note`, for a sub-line under the value, and all three
 * strips that used this component had one on every tile: "Every KaleidoSwap V2
 * pair, not just yours", "Excludes 3 unpriced of 17 pools", "No positions indexed
 * yet", "Unavailable", "Fillable now". Each was accurate. The prop is gone anyway,
 * along with `excludeNote` (pool/layout.tsx) and `coverageNote`/`degradedNote`
 * (useMarketStats.ts) which existed only to produce them.
 *
 * The reason is the strip's own geometry, not the copy. `.strip` is a 2×2 grid
 * under 720px, so each tile is about half a phone wide and a sentence under the
 * figure wraps to three or four lines; four tiles of that is a screenful of
 * caveats sitting above the table the reader came for, and it pushed the actual
 * numbers off the first screen. Removed from /leaderboard first, for that reason,
 * then from the other two so one strip does not annotate what another does not.
 *
 * The signal is not lost, because the tiles were already carrying it: every figure
 * routes through `lib/format/figures.ts`, which renders an unmeasurable value as
 * an em dash rather than a confident 0. "—" is the short form of every note listed
 * above. If a specific gap ever needs naming again, name it next to the rows it is
 * about, where there is a full line's width for it — not in a quarter-screen tile.
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
}: {
  label: string;
  /**
   * Pre-formatted, and a string rather than `number | null`. The tile does not
   * decide what an absent figure looks like — `lib/format/figures.ts` does, and
   * its `DASH` is the answer everywhere. A tile that took a nullable number
   * would be a second place for "$0" to creep back in.
   */
  value: string;
}) {
  return (
    <div className={s.tile}>
      <span className={s.label}>{label}</span>
      <span className={`${s.value} tabular`}>{value}</span>
    </div>
  );
}
