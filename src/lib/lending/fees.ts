/**
 * The two lending fees, and what they mean for each side of a loan.
 *
 * Both live in diamond storage (`AppStorage.ONE_PERCENT_BPS` and
 * `AppStorage.LIQUIDITY_BPS`), are owner-set through `setBPS` / `setLiquidityBps`,
 * and are readable through `getBPS()` / `getLiquidityBPS()`. Measured on all five
 * deployed chains 2026-08-24: 1000 bps and 640 bps everywhere.
 *
 * Nothing in `src/` read either one. That is the gap this module exists to close,
 * and it is a disclosure gap rather than a cosmetic one: a lender picking an APR
 * was choosing a number the protocol then takes a tenth of, and a borrower
 * browsing offers had no way to learn that liquidation costs more than the debt.
 *
 * Kept free of React so the arithmetic can be tested directly — see fees.test.ts.
 * The hook that reads the chain is `src/hooks/useLendingFees.ts`.
 */

/** Basis-point denominator, matching `Utils.calculateFeesPercentage`. */
export const BPS_DENOMINATOR = 10_000;

/**
 * The liquidator's share of the penalty, as a percentage.
 *
 * Hardcoded in the facet rather than stored — `_liquidationPenaltySplitUsd` does
 * `liquidatorUsd = (penaltyUsd * 75) / 100` and gives the protocol the remainder,
 * so this cannot be read back and has to be mirrored here. Update both together.
 */
export const LIQUIDATOR_PENALTY_SHARE_PCT = 75;

export interface LendingFeeRates {
  /**
   * The protocol's cut of loan interest, in basis points.
   *
   * `null` means the read failed, and is deliberately not 0: the facet treats 0
   * as "never configured" and reverts every repayment on it, so rendering an
   * unread fee as "no fee" would state the opposite of what a zero would mean.
   */
  interestFeeBps: number | null;
  /** The liquidation penalty, in basis points. `null` for the same reason. */
  liquidationPenaltyBps: number | null;
}

/** Basis points as a percentage number — 640 → 6.4. */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/**
 * What a lender actually earns, given the rate on the order book.
 *
 * `repayLoan` credits the lender `payment - fee` where the fee is
 * `interestFeeBps` of the interest inside that payment, so the whole of the
 * protocol's cut lands on the lender's yield and none of it on the borrower's
 * cost. A gross rate of 1200 bps at a 1000 bps fee nets 1080 bps.
 *
 * Returns `null` when the fee is unknown, so a caller cannot accidentally
 * present the gross rate as a net one.
 */
export function netLenderRateBps(
  grossBps: number,
  interestFeeBps: number | null,
): number | null {
  if (interestFeeBps === null) return null;
  return (grossBps * (BPS_DENOMINATOR - interestFeeBps)) / BPS_DENOMINATOR;
}

/** The share of interest the lender keeps, in basis points. 1000 → 9000. */
export function lenderInterestShareBps(interestFeeBps: number): number {
  return BPS_DENOMINATOR - interestFeeBps;
}

/**
 * How the liquidation penalty splits, in basis points.
 *
 * The penalty is charged on the lender's claim — the debt, or everything seized
 * when the position could not cover it — and comes out of collateral *above*
 * that claim, so the borrower bears it and the lender is made whole first.
 */
export function penaltySplitBps(liquidationPenaltyBps: number): {
  liquidator: number;
  protocol: number;
} {
  const liquidator =
    (liquidationPenaltyBps * LIQUIDATOR_PENALTY_SHARE_PCT) / 100;
  return { liquidator, protocol: liquidationPenaltyBps - liquidator };
}

/** Trims trailing zeros so 10 reads "10%" and 6.4 reads "6.4%". */
export function formatBps(bps: number | null): string {
  if (bps === null) return "—";
  return `${Number(bpsToPercent(bps).toFixed(2))}%`;
}
