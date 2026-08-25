/**
 * Figure formatting specific to the Liquidity section.
 *
 * The generic three — `DASH`, `usd`, `qty`, `pct` — moved to
 * `@/lib/format/figures` once a fourth strip needed them; this file keeps the two
 * that describe a KaleidoSwap V2 pair and nothing else. `layout.tsx`'s strip and
 * `page.tsx`'s pools table still share both, which is the point: they are one
 * card sitting directly above one table reading the same `usePoolData()` rows, so
 * a total that rounds or dashes differently from the column it sums reads as a
 * bug in the numbers.
 */

import { DASH } from "@/lib/format/figures";

/** A pool's fee, from the pair's own `swapFee()` in bps of 10000. */
export const feeLabel = (bps: number | null) =>
  bps === null ? DASH : `${(bps / 100).toFixed(2)}%`;

/** How much of a day the volume sample actually covered. Volume is extrapolated
    from a block window, so a five-hour sample scaled to 24h is a projection, and
    the reader is entitled to know which. */
export const volumeTitle = (sec: number | null) =>
  sec === null
    ? "No usable block window — volume not sampled"
    : `Extrapolated from a ${(sec / 3600).toFixed(1)}h sample`;
