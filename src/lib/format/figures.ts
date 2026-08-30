/**
 * Figure formatting for the stat strips, and for the position rows that grew the
 * same need.
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
 * sampling window, and neither means anything off that page.
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

/**
 * A token amount at a readable precision, scaled to its size.
 *
 * `formatUnits` output is exact and unreadable — an 18-decimal balance is a
 * 20-character string. Small holdings need more places than large ones (0.000412
 * WBTC matters, 0.000412 of 84,200 KLD does not), hence the three bands. Display
 * only; nothing derives from the returned string.
 *
 * Unlike `qty` it takes a fallback rather than producing DASH, because its caller
 * has the exact string the chain gave it and that is a better answer than an em
 * dash for a value this cannot round (an overflowed double, a balance so large
 * `formatUnits` outputs something unparseable).
 *
 * WHY IT LIVES HERE AND NOT IN usePortfolio
 *
 * It was written there and exported from there, for `lib/mock/portfolio.ts` — which
 * derives its rows from the same fixtures the product pages use and would
 * otherwise have to re-implement it to make its amounts look like the live page's.
 * That import closed a cycle: usePortfolio imports `@/lib/mock` for its fixture,
 * the barrel loads `lib/mock/portfolio`, and that module calls this function while
 * evaluating its own top level. Whichever of the two the app happened to load
 * first decided whether `shortAmount` was initialised by then or still in its
 * temporal dead zone, so the failure would have been a load-order-dependent
 * ReferenceError at import time rather than anything reproducible. A leaf module
 * both sides import cannot close a cycle.
 */
export const shortAmount = (value: number, fallback: string): string => {
  if (!Number.isFinite(value)) return fallback;
  if (value === 0) return "0";
  const dp = Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 1 ? 4 : 6;
  return value.toLocaleString("en-US", { maximumFractionDigits: dp });
};
