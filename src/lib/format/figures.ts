/**
 * Figure formatting for the stat strips.
 *
 * There are four of these strips — Leaderboard, Liquidity, Stable and Lending —
 * and three of them had grown their own copy of these three functions. The
 * copies agreed in their bodies and had already drifted in their comments, which
 * is the state immediately before they stop agreeing at all. Two strips reading
 * the same `/api/market/overview` response and rounding it differently is a bug
 * a reader would reasonably read as two different numbers.
 *
 * Only the generic ones live here. `feeLabel` and `volumeTitle` stay in
 * `pool/format.ts`: one describes a V2 pair's `swapFee()` and the other a block
 * sampling window, and neither means anything off that page. The near-identical
 * pair in `portfolio/page.tsx` and `constants/utils/portfolioformat.ts` is a
 * separate consolidation — those format a position, not a headline, and folding
 * them in on the way past would make this a refactor of the portfolio rather
 * than of the strips.
 */

/**
 * What an unmeasured figure renders as.
 *
 * Never "$0". A zero is a measurement, and a reader has no way to tell an empty
 * book from an unreachable one when both render as one — the whole reason every
 * field of `MarketOverview` is nullable.
 */
export const DASH = "—";

export const usd = (n: number | null | undefined, dp = 0) =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      })
    : DASH;

/** Counts and token quantities. The unit lives in the label, not the value. */
export const qty = (n: number | null | undefined, dp = 0) =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      })
    : DASH;

export const pct = (n: number | null | undefined, dp = 2) =>
  typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(dp)}%` : DASH;
