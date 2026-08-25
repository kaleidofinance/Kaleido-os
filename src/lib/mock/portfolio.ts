import type { Portfolio } from "@/hooks/usePortfolio";

import { MOCK_STABLE_BALANCES } from "./stable";
import { MOCK_STAKE } from "./stake";

/**
 * The demo unified portfolio.
 *
 * `usePortfolio` is pure aggregation — it stitches four hooks together and
 * normalises them onto one shape — so a fixture for it has to agree with the
 * fixtures for its inputs, or the app contradicts itself between /portfolio and
 * the product page a figure came from. Every number below is therefore derived
 * from ./lending, ./positions, ./stable and ./stake rather than chosen freely:
 *
 *   collateralUsd  34,780.00  = 4.2 ETH × 3,400 + 12,000 USDC + 8,500 kfUSD
 *                              (MOCK_COLLATERAL, at ./pools' assumed prices)
 *   debtUsd        26,732.20  = 3.7135 ETH × 3,400 + 4,426.80 + 9,679.50
 *                              (the three MOCK_LOANS repayments)
 *   unclaimed         246.31  = MOCK_STABLE_REWARDS.totalRewards
 *   netValue       20,527.91  = 34,780.00 + 12,480.11 − 26,732.20, which is the
 *                              hook's own formula: collateral, plus the USD value
 *                              of earning positions, minus debt.
 *
 * `health` is 1.18 rather than the 1.30 that raw collateral over debt would
 * give, because the contract weights each collateral token by its liquidation
 * threshold before dividing. It sits in the warning band — below HEALTH_WARN
 * (1.25) but above HEALTH_CRITICAL (1.1) — so the liquidation alert fires at
 * warning severity. An always-healthy fixture would leave the whole alerts
 * surface unrendered, which is most of what this page is for.
 *
 * IDS MATCH THE REAL GENERATOR: `collateral-${symbol}`, `debt-${requestId}`,
 * `liquidity-${tokenId}`, `staking-stkld`, `vault-kafusd`. React keys off them.
 *
 * SYMBOLS ARE SPELLED OUT HERE. The real hook resolves them from the token
 * registry (`symbolForAddress`), which has no entry for the fixtures' addresses
 * and would render `0x1234…abcd`; that fallback is correct behaviour for an
 * unknown token, and not what these rows are meant to demonstrate.
 *
 * `valueUsd: null` is left null wherever the hook genuinely cannot price a
 * position: per-token collateral (the contract exposes only the aggregate),
 * stKLD (KLD has no market before TGE), and concentrated liquidity (valuing it
 * means converting liquidity plus the current tick into token amounts first).
 * Those dashes are the honest output, so the fixture keeps them.
 */
export const MOCK_PORTFOLIO: Portfolio = {
  netValue: 20_527.91,
  collateralUsd: 34_780,
  debtUsd: 26_732.2,
  health: 1.18,
  unclaimedYieldUsd: 246.31,

  borrowing: [
    // Three of the five collateral slots hold a balance; the hook filters the
    // zeroes out, so USDR and USDT from MOCK_COLLATERAL are absent here.
    {
      id: "collateral-ETH",
      kind: "collateral",
      label: "ETH",
      sublabel: "Collateral",
      amount: "4.2",
      valueUsd: null,
      apy: null,
      state: { tone: "ok", text: "Deposited" },
    },
    {
      id: "collateral-USDC",
      kind: "collateral",
      label: "USDC",
      sublabel: "Collateral",
      amount: "12000",
      valueUsd: null,
      apy: null,
      state: { tone: "ok", text: "Deposited" },
    },
    {
      id: "collateral-kfUSD",
      kind: "collateral",
      label: "kfUSD",
      sublabel: "Collateral",
      amount: "8500",
      valueUsd: null,
      apy: null,
      state: { tone: "ok", text: "Deposited" },
    },
    // The three debts, in MOCK_LOANS order. `apy` is the loan's basis points
    // divided by 100 — 610 bps is 6.1%, not 610%.
    {
      id: "debt-5121",
      kind: "debt",
      label: "ETH",
      sublabel: "Borrowed · P2P",
      amount: "3.7135",
      valueUsd: null,
      apy: 6.1,
      state: { tone: "warn", text: "Outstanding" },
    },
    {
      id: "debt-5126",
      kind: "debt",
      label: "USDT",
      sublabel: "Borrowed · P2P",
      amount: "4426.8",
      valueUsd: null,
      apy: 5.4,
      state: { tone: "warn", text: "Outstanding" },
    },
    {
      id: "debt-5127",
      kind: "debt",
      label: "USDC",
      sublabel: "Borrowed · P2P",
      amount: "9679.5",
      valueUsd: null,
      apy: 7.55,
      state: { tone: "warn", text: "Outstanding" },
    },
  ],

  earning: [
    {
      id: "staking-stkld",
      kind: "staking",
      label: "stKLD",
      sublabel: "Liquid staking",
      amount: MOCK_STAKE.stakedBalance,
      valueUsd: null,
      apy: null,
      state: { tone: "ok", text: "Accruing" },
    },
    /*
     * Four of the five MOCK_V3_POSITIONS. Token 1755 is missing on purpose: its
     * liquidity is "0" and usePortfolio.ts:292 skips those, so a fully-withdrawn
     * position appears on /pool/positions (where its uncollected fees can still
     * be claimed) but not here. Keeping the two lists deliberately different is
     * the only way to notice if that rule ever changes.
     */
    {
      id: "liquidity-1842",
      kind: "liquidity",
      label: "WETH / USDC",
      sublabel: "Liquidity · 0.30%",
      amount: null,
      valueUsd: null,
      apy: null,
      state: { tone: "ok", text: "In range" },
    },
    {
      id: "liquidity-1917",
      kind: "liquidity",
      label: "KLD / USDC",
      sublabel: "Liquidity · 0.30%",
      amount: null,
      valueUsd: null,
      apy: null,
      state: { tone: "ok", text: "In range" },
    },
    {
      // The one out-of-range position, which is what raises the second alert.
      id: "liquidity-2033",
      kind: "liquidity",
      label: "WBTC / WETH",
      sublabel: "Liquidity · 1.00%",
      amount: null,
      valueUsd: null,
      apy: null,
      state: { tone: "bad", text: "Out of range" },
    },
    {
      id: "liquidity-2104",
      kind: "liquidity",
      label: "kfUSD / USDC",
      sublabel: "Liquidity · 0.05%",
      amount: null,
      valueUsd: null,
      apy: null,
      state: { tone: "ok", text: "In range" },
    },
    {
      /*
       * The only priced earning row, and so the only one contributing to
       * netValue. kafUSD is dollar-denominated, hence 1:1. The state reflects
       * MOCK_STABLE_WITHDRAWAL's open request, matching the branch at
       * usePortfolio.ts:326 — not "Earning", which is the no-request case.
       */
      id: "vault-kafusd",
      kind: "vault",
      label: "kafUSD",
      sublabel: "Yield vault",
      amount: MOCK_STABLE_BALANCES.kafUSD,
      valueUsd: 12_480.11,
      apy: 7.42,
      state: { tone: "warn", text: "Unlocks in 3d 4h 12m" },
    },
  ],

  // Sorted most urgent first, as the hook does: critical, warning, info.
  alerts: [
    {
      id: "health",
      severity: "warning",
      title: "Health factor approaching the liquidation threshold",
      detail:
        "Health factor is 1.18. Liquidation occurs at 1.00 — repaying debt or adding collateral raises it.",
      href: "/myloans",
    },
    {
      id: "lp-out-of-range",
      severity: "warning",
      title: "1 liquidity position out of range",
      detail:
        "Out-of-range liquidity earns no fees. Rebalance or withdraw to put the capital back to work.",
      href: "/pool/positions",
    },
    {
      id: "unclaimed-yield",
      severity: "info",
      title: "Yield ready to claim",
      detail: "$246.31 available from the kafUSD vault.",
      href: "/stable",
    },
  ],

  isLoading: false,
};
