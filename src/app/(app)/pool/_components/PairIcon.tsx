import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";

import s from "../pool.module.css";

/**
 * One half of an overlapping pair disc. Falls back to the three-letter
 * monogram, which is still the right answer for our own undeployed tokens.
 *
 * Extracted because it was byte-identical in two files — the pools table and the
 * positions list — and the detail page made three. The overlap itself is not
 * here: it comes from `.tki + .tki { margin-left: -10px }` in pool.module.css,
 * so two of these inside one `.pair` overlap and one on its own does not.
 *
 * Deliberately imports the section stylesheet rather than taking a className.
 * `.tki` carries the opaque 2px ring that separates the front disc from the one
 * behind it, and a caller free to swap that class could drop the ring and get
 * two marks that merge into each other.
 */
export default function PairIcon({ symbol }: { symbol: string }) {
  return (
    <span className={`${s.tki} ${hasTokenIcon(symbol) ? s.tkiArt : ""}`}>
      <TokenIcon symbol={symbol} size={24} fallback={symbol.slice(0, 3)} />
    </span>
  );
}
