import type {
  Portfolio,
  Position,
  PositionGroup,
} from "@/hooks/usePortfolio";
import { positionAmounts, positionValueUsd } from "@/lib/dex/positionValue";
import { shortAmount } from "@/lib/format/figures";

import { mockBalanceOf } from "./balances";
import { MOCK_TOKENS } from "./pools";
import { MOCK_V3_POSITIONS } from "./positions";
import { MOCK_USD } from "./quotes";
import {
  MOCK_STABLE_BALANCES,
  MOCK_STABLE_REWARDS,
  MOCK_STABLE_STATS,
  MOCK_STABLE_WITHDRAWAL,
} from "./stable";
import { MOCK_STAKE } from "./stake";

/**
 * The demo unified portfolio, in the five groups `usePortfolio` publishes.
 *
 * `usePortfolio` is pure aggregation — it stitches six hooks together and
 * normalises them onto one shape — so a fixture for it has to agree with the
 * fixtures for its inputs, or the app contradicts itself between /portfolio and
 * the product page a figure came from.
 *
 * MOST OF THIS FILE IS DERIVED, NOT TYPED IN
 *
 * The previous version of this fixture carried hand-computed products in its
 * header ("4.2 ETH × 3,400 …") and hand-typed results in its rows, which is two
 * copies of one calculation waiting to disagree. The rows below are computed from
 * the same fixtures the hook reads instead:
 *
 *   Wallet        `mockBalanceOf(symbol)` × `MOCK_USD[symbol]`, over the tokens
 *                 the read chain's registry actually carries.
 *   Staking & LP  `MOCK_STAKE.stakedBalance` at ./quotes' stKLD price, and each
 *                 position in ./positions run through the real
 *                 `lib/dex/positionValue.ts` — the same module the live hook
 *                 uses, with ./pools' decimals and ./quotes' prices. So the token
 *                 split shown for a position follows from the `sqrtPriceX96` and
 *                 tick range ./positions declares, and cannot drift from the
 *                 in-range badge beside it.
 *   Subtotals     summed from the rows, and `netValue` summed from the subtotals,
 *                 by the same rule the hook documents: one addition over every
 *                 group's contribution.
 *
 * Lending, Borrowing and Stable rows are literals, because their quantities are
 * already stated exactly in ./lending and ./stable and are round enough to carry
 * across verbatim. Each is annotated with the fixture row it comes from.
 *
 * THE VIEWER'S POSITIONS, AND WHERE ELSE THEY APPEAR
 *
 * Every lending row here is one of MOCK_VIEWER's, so /portfolio and /mylends,
 * /myloans and /borrow describe the same wallet:
 *
 *   offer 3045   60,000 USDC @ 7.25%, live      ./lending:163
 *   offer 3046   8 ETH @ 9.00%, past its date   ./lending:175  → Expired
 *   loan  5123   8,384 USDT owed @ 4.80%        ./lending:253
 *   loan  5124   16,087.5 USDC owed @ 7.25%     ./lending:266  → Past due
 *   debt  5121   3.7135 ETH @ 6.10%             ./lending:227
 *   debt  5126   4,426.8 USDT @ 5.40%           ./lending:289
 *   debt  5127   9,679.5 USDC @ 7.55%           ./lending:302  → Past due
 *
 * `collateralUsd` 34,780.00 = 4.2 ETH × 3,400 + 12,000 USDC + 8,500 kfUSD
 * (MOCK_COLLATERAL at ./quotes' prices) and `debtUsd` 26,732.20 is the sum of the
 * three debt rows above — which is also what the Borrowing group's rows add up
 * to, because the hook prices a debt row from the same oracle call that produces
 * the total. Both stay, and both are read elsewhere: hooks/v2/useBorrowV2.ts
 * reads `MOCK_PORTFOLIO.collateralUsd` and `.health` directly, so removing either
 * would break the borrow flow's fixture rather than only this page's.
 *
 * `health` is 1.18 rather than the 1.30 that raw collateral over debt would
 * give, because the contract weights each collateral token by its liquidation
 * threshold before dividing. It sits in the warning band — below HEALTH_WARN
 * (1.25) but above HEALTH_CRITICAL (1.1) — so the liquidation alert fires at
 * warning severity. An always-healthy fixture would leave the whole alerts
 * surface unrendered, which is most of what this page is for.
 *
 * NOTHING IS UNPRICED HERE, AND THAT IS NOT A CHEAT
 *
 * `MOCK_USD` carries a price for every symbol these fixtures use, including KLD
 * and stKLD — ./quotes derives both from ./pools' own reserves, since a fixture
 * pool that trades KLD has already fixed what a KLD is worth. So every group
 * prices fully and `netValuePartial` is false. Live, the priceable table is eight
 * symbols and a wallet holding WBTC or KLD will produce a partial total; that
 * path is real-mode behaviour and cannot be reproduced by a fixture whose own
 * price table is complete without inventing a hole in it.
 *
 * IDS MATCH THE REAL GENERATOR: `wallet-${address}`, `offer-${listingId}`,
 * `loan-${requestId}`, `collateral-${symbol}`, `debt-${requestId}`,
 * `liquidity-${tokenId}`, `staking-stkld`, `vault-kafusd`, `yield-unclaimed`.
 * React keys off them. The wallet rows key on the symbol instead of an address,
 * because the fixture has no registry addresses to key on — the same reason the
 * labels here are spelled out rather than resolved through `symbolForAddress`,
 * which would render these tokens as `0x1234…abcd`.
 */

/** Sum a group's rows the way the hook's `sumRows` does. */
const sumRows = (rows: Position[]): number | null => {
  const priced = rows.filter(
    (r) => r.valueUsd !== null && Number.isFinite(r.valueUsd),
  );
  if (!priced.length) return rows.length ? null : 0;
  return priced.reduce((acc, r) => acc + (r.valueUsd as number), 0);
};

/**
 * What the demo wallet holds on the read chain, in the hook's own order: the
 * native asset, then the chain's declared ERC20s, then the stablecoins it
 * records, then ours.
 *
 * kafUSD and stKLD are absent because `WALLET_EXCLUDES` drops them — the Stable
 * and Staking groups own those balances, and listing them twice would count the
 * same dollars twice in `netValue`. WBTC, DAI, POL and HYPE are absent for a
 * different reason: Sepolia's registry does not carry them (registry.ts:320), so
 * a wallet on the read chain cannot hold them however generous ./balances is.
 */
const WALLET_SYMBOLS = [
  "ETH",
  "WETH",
  "USDC",
  "USDT",
  "USDe",
  "KLD",
  "kfUSD",
] as const;

const walletRows: Position[] = WALLET_SYMBOLS.map((symbol) => {
  const amount = mockBalanceOf(symbol);
  const held = Number(amount);
  const price = MOCK_USD[symbol] ?? null;
  return {
    id: `wallet-${symbol}`,
    kind: "wallet" as const,
    label: symbol,
    sublabel: symbol === "ETH" ? "Native balance" : "Wallet balance",
    amount: shortAmount(held, amount),
    valueUsd: price === null ? null : held * price,
    apy: null,
    state: { tone: "ok" as const, text: "Idle" },
  };
})
  /* Largest first, as the hook sorts them. */
  .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

/** ./pools' tokens by address, so a position's legs can be resolved. */
const MOCK_TOKEN_BY_ADDRESS = new Map(
  Object.values(MOCK_TOKENS).map((t) => [t.address.toLowerCase(), t]),
);

/**
 * The staking row plus one row per position, valued by the real module.
 *
 * Token 1755 drops out here without a special case: its liquidity is "0" and the
 * hook skips those, so a fully-withdrawn position appears on /pool/positions
 * (where its uncollected fees can still be claimed) and not here. Keeping the two
 * lists deliberately different is the only way to notice if that rule changes.
 */
const stakedKld = Number(MOCK_STAKE.stakedBalance);

const stakingRows: Position[] = [
  {
    /* Priced, unlike live: ./quotes derives a stKLD rate from ./pools' KLD
       reserves, where the real hook gets null until KLD has a feed. */
    id: "staking-stkld",
    kind: "staking",
    label: "stKLD",
    sublabel: "Liquid staking",
    amount: shortAmount(stakedKld, MOCK_STAKE.stakedBalance),
    valueUsd: stakedKld * MOCK_USD.stKLD,
    apy: null,
    state: { tone: "ok", text: "Accruing" },
  },
  ...MOCK_V3_POSITIONS.filter((p) => Number(p.liquidity) !== 0).map((p) => {
    const t0 = MOCK_TOKEN_BY_ADDRESS.get(p.token0.toLowerCase());
    const t1 = MOCK_TOKEN_BY_ADDRESS.get(p.token1.toLowerCase());
    const amounts =
      t0 && t1
        ? positionAmounts({
            sqrtPriceX96: p.sqrtPriceX96,
            tickLower: p.tickLower,
            tickUpper: p.tickUpper,
            liquidity: p.liquidity,
            decimals0: t0.decimals,
            decimals1: t1.decimals,
          })
        : null;
    const label = `${t0?.symbol ?? "?"} / ${t1?.symbol ?? "?"}`;
    return {
      id: `liquidity-${p.tokenId}`,
      kind: "liquidity" as const,
      label,
      sublabel: `Liquidity · ${(p.fee / 10000).toFixed(2)}%`,
      amount: amounts
        ? `${shortAmount(amounts.amount0, "—")} ${t0?.symbol} + ${shortAmount(
            amounts.amount1,
            "—",
          )} ${t1?.symbol}`
        : null,
      valueUsd: positionValueUsd(
        amounts,
        MOCK_USD[t0?.symbol ?? ""] ?? null,
        MOCK_USD[t1?.symbol ?? ""] ?? null,
      ),
      apy: null,
      state: p.inRange
        ? { tone: "ok" as const, text: "In range" }
        : { tone: "bad" as const, text: "Out of range" },
    };
  }),
];

/* The three MOCK_LOANS repayments, priced at ./quotes' rates. NEGATIVE, because
   netValue is one addition over the group subtotals: a liability carries its own
   sign rather than being subtracted somewhere else. */
const DEBT_ETH_USD = 3.7135 * MOCK_USD.ETH;
const DEBT_USDT_USD = 4426.8 * MOCK_USD.USDT;
const DEBT_USDC_USD = 9679.5 * MOCK_USD.USDC;
const DEBT_TOTAL_USD = DEBT_ETH_USD + DEBT_USDT_USD + DEBT_USDC_USD;

const COLLATERAL_USD =
  4.2 * MOCK_USD.ETH + 12_000 * MOCK_USD.USDC + 8_500 * MOCK_USD.kfUSD;

const UNCLAIMED_USD = Number(
  MOCK_STABLE_REWARDS.totalRewards.replace(/[^0-9.-]/g, ""),
);

const lendingRows: Position[] = [
  {
    // ./lending:253 — funded by the viewer, being repaid on time.
    id: "loan-5123",
    kind: "loan",
    label: "USDT",
    sublabel: "Lent · P2P",
    amount: shortAmount(8384, "8384"),
    valueUsd: 8384 * MOCK_USD.USDT,
    apy: 4.8,
    state: { tone: "ok", text: "Repaying" },
  },
  {
    // ./lending:266 — funded by the viewer and past its return date.
    id: "loan-5124",
    kind: "loan",
    label: "USDC",
    sublabel: "Lent · P2P",
    amount: shortAmount(16_087.5, "16087.5"),
    valueUsd: 16_087.5 * MOCK_USD.USDC,
    apy: 7.25,
    state: { tone: "bad", text: "Past due" },
  },
  {
    // ./lending:163 — the viewer's live offer, nobody has drawn on it.
    id: "offer-3045",
    kind: "offer",
    label: "USDC",
    sublabel: "Offer · unfilled",
    amount: shortAmount(60_000, "60000"),
    valueUsd: 60_000 * MOCK_USD.USDC,
    apy: 7.25,
    state: { tone: "warn", text: "Awaiting a borrower" },
  },
  {
    // ./lending:175 — the viewer's offer, past its own return date.
    id: "offer-3046",
    kind: "offer",
    label: "ETH",
    sublabel: "Offer · unfilled",
    amount: shortAmount(8, "8"),
    valueUsd: 8 * MOCK_USD.ETH,
    apy: 9,
    state: { tone: "bad", text: "Expired" },
  },
];

const borrowingRows: Position[] = [
  /* Three of the five collateral slots hold a balance; the hook filters the
     zeroes out, so USDR and USDT from MOCK_COLLATERAL are absent here. Their
     `valueUsd` is null because the contract exposes only the aggregate, which is
     what the group's subtotal uses — and their tone is the health factor's, so a
     position drifting toward liquidation shows on the rows that would be seized
     rather than only in the strip. `toneForHealth(1.18)` is "warn". */
  {
    id: "collateral-ETH",
    kind: "collateral",
    label: "ETH",
    sublabel: "Collateral",
    amount: "4.2",
    valueUsd: null,
    apy: null,
    state: { tone: "warn", text: "Deposited" },
  },
  {
    id: "collateral-USDC",
    kind: "collateral",
    label: "USDC",
    sublabel: "Collateral",
    amount: "12000",
    valueUsd: null,
    apy: null,
    state: { tone: "warn", text: "Deposited" },
  },
  {
    id: "collateral-kfUSD",
    kind: "collateral",
    label: "kfUSD",
    sublabel: "Collateral",
    amount: "8500",
    valueUsd: null,
    apy: null,
    state: { tone: "warn", text: "Deposited" },
  },
  /* The three debts, in MOCK_LOANS order. `apy` is the loan's basis points
     divided by 100 — 610 bps is 6.1%, not 610%. */
  {
    id: "debt-5121",
    kind: "debt",
    label: "ETH",
    sublabel: "Borrowed · P2P",
    amount: "3.7135",
    valueUsd: -DEBT_ETH_USD,
    apy: 6.1,
    state: { tone: "warn", text: "Outstanding" },
  },
  {
    id: "debt-5126",
    kind: "debt",
    label: "USDT",
    sublabel: "Borrowed · P2P",
    amount: "4426.8",
    valueUsd: -DEBT_USDT_USD,
    apy: 5.4,
    state: { tone: "warn", text: "Outstanding" },
  },
  {
    // Past its return date (./lending:302), which is what raises the critical
    // alert — the one state on this page a user has to act on today.
    id: "debt-5127",
    kind: "debt",
    label: "USDC",
    sublabel: "Borrowed · P2P",
    amount: "9679.5",
    valueUsd: -DEBT_USDC_USD,
    apy: 7.55,
    state: { tone: "bad", text: "Past due" },
  },
];

const stableRows: Position[] = [
  {
    /*
     * kafUSD is dollar-denominated, hence 1:1 — the same assumption the price
     * table makes (ASSUMED_PAR in lib/points/prices.ts), rather than a second,
     * private one invented here. The state reflects MOCK_STABLE_WITHDRAWAL's open
     * request, matching the hook's pending branch — not "Earning", which is the
     * no-request case.
     */
    id: "vault-kafusd",
    kind: "vault",
    label: "kafUSD",
    sublabel: "Yield vault",
    amount: shortAmount(
      Number(MOCK_STABLE_BALANCES.kafUSD),
      MOCK_STABLE_BALANCES.kafUSD,
    ),
    valueUsd: Number(MOCK_STABLE_BALANCES.kafUSD) * MOCK_USD.kafUSD,
    apy: MOCK_STABLE_STATS.totalYieldAPY
      ? parseFloat(MOCK_STABLE_STATS.totalYieldAPY)
      : null,
    state: { tone: "warn", text: `Unlocks in ${MOCK_STABLE_WITHDRAWAL.unlockTime}` },
  },
  {
    /* Its own row rather than part of the vault's: the rewards sit in the yield
       treasury until claimYield moves them, so these are two balances and not one
       figure viewed twice. It is also the only row on the page representing money
       the user has to press a button to keep. */
    id: "yield-unclaimed",
    kind: "yield",
    label: "Yield",
    sublabel: "Unclaimed · kafUSD vault",
    amount: null,
    valueUsd: UNCLAIMED_USD,
    apy: null,
    state: { tone: "warn", text: "Ready to claim" },
  },
];

const groups: PositionGroup[] = [
  {
    id: "wallet",
    title: "Wallet",
    subtotalUsd: sumRows(walletRows),
    unpriced: [],
    rows: walletRows,
    empty: "No token balances on this network.",
    href: "/trade/swap",
  },
  {
    id: "lending",
    title: "Lending",
    subtotalUsd: sumRows(lendingRows),
    unpriced: [],
    rows: lendingRows,
    empty: "No offers posted and no loans funded.",
    href: "/lend",
  },
  {
    id: "borrowing",
    title: "Borrowing",
    /* The one group whose subtotal is not a sum of its rows: collateral carries
       no per-token USD, so the protocol's aggregate minus the debt the same
       oracle priced is the group's contribution. See usePortfolio's note. */
    subtotalUsd: COLLATERAL_USD - DEBT_TOTAL_USD,
    unpriced: [],
    rows: borrowingRows,
    empty: "No collateral deposited and nothing borrowed.",
    href: "/borrow",
  },
  {
    id: "stable",
    title: "Stable",
    subtotalUsd: sumRows(stableRows),
    unpriced: [],
    rows: stableRows,
    empty: "No kfUSD minted and nothing in the vault.",
    href: "/stable",
  },
  {
    id: "staking",
    title: "Staking & LP",
    subtotalUsd: sumRows(stakingRows),
    unpriced: [],
    rows: stakingRows,
    empty: "Nothing staked and no liquidity provided.",
    href: "/stake",
  },
];

export const MOCK_PORTFOLIO: Portfolio = {
  netValue: groups.reduce((acc, g) => acc + (g.subtotalUsd ?? 0), 0),
  /* False because every group priced in full — see the header. */
  netValuePartial: groups.some((g) => g.unpriced.length > 0),
  collateralUsd: COLLATERAL_USD,
  debtUsd: DEBT_TOTAL_USD,
  health: 1.18,
  unclaimedYieldUsd: UNCLAIMED_USD,
  groups,

  /* Sorted most urgent first, as the hook does: critical, warning, info. Each one
     is raised by a row above, so removing a row here without removing its alert
     would leave the page warning about something it does not show. */
  alerts: [
    {
      id: "debt-past-due",
      severity: "critical",
      title: "1 loan past the return date",
      detail:
        "An overdue loan can be liquidated by its lender at any time. Repaying it releases the collateral behind it.",
      href: "/myloans",
    },
    {
      id: "health",
      severity: "warning",
      title: "Health factor approaching the liquidation threshold",
      detail:
        "Health factor is 1.18. Liquidation occurs at 1.00 — repaying debt or adding collateral raises it.",
      href: "/myloans",
    },
    {
      id: "lent-past-due",
      severity: "warning",
      title: "1 loan you funded is overdue",
      detail:
        "The borrower has passed the return date, so the collateral behind the loan can be claimed.",
      href: "/mylends",
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
      detail: `${MOCK_STABLE_REWARDS.totalRewards} available from the kafUSD vault.`,
      href: "/stable",
    },
    {
      id: "offers-unfilled",
      severity: "info",
      title: "2 offers waiting for a borrower",
      detail:
        "Capital in an unfilled offer earns nothing. Lowering the rate or the term makes it easier to fill.",
      href: "/mylends",
    },
  ],

  isLoading: false,
};
