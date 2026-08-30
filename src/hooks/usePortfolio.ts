"use client";

import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";

import useGetValueAndHealth from "@/hooks/useGetValueAndHealth";
import useGetActiveRequest from "@/hooks/useGetActiveRequest";
import { useLenderPositions } from "@/hooks/useLenderPositions";
import { useSpotPrices } from "@/hooks/useSpotPrices";
import { useStablecoin } from "@/hooks/useStablecoin";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useV3Positions } from "@/hooks/dex/useV3Positions";
import { positionAmounts, positionValueUsd } from "@/lib/dex/positionValue";
/* Shared with `lib/mock/portfolio.ts`, which formats its fixture rows with the
   same function so the demo amounts look like the live ones. It lives in a leaf
   module because importing it *from here* closed a cycle — see its own note. */
import { shortAmount } from "@/lib/format/figures";
import { getKaleidoContract } from "@/config/contracts";
import { readOnlyProvider, READ_ONLY_CHAIN_ID } from "@/config/provider";
import { convertbasisPointsToPercentage } from "@/constants/utils/FormatInterestRate";
import { decimalsForAddress, symbolForAddress } from "@/constants/tokens";
import { MOCK_DATA, MOCK_PORTFOLIO } from "@/lib/mock";

/**
 * usePortfolio — the unified view of everything an address holds.
 *
 * Kaleido's products each have their own hook, each reading a different contract.
 * Nothing joins them, so no screen can answer "what do I own" without stitching
 * them together by hand. This does that stitching once and normalises the
 * results onto a single Position shape, grouped the way every other DeFi
 * portfolio groups them: by where the money is, not by what it does.
 *
 * FIVE GROUPS, AND WHY EACH ASSET SITS IN EXACTLY ONE
 *
 *   Wallet        native + every registered ERC20 the address itself holds
 *   Lending       offers posted, loans funded (escrowed in the protocol)
 *   Borrowing     collateral deposited, debt outstanding
 *   Stable        the kafUSD vault position and its unclaimed yield
 *   Staking & LP  stKLD, and concentrated liquidity positions
 *
 * Double counting is the failure mode a portfolio page dies of, so ownership is
 * decided once, here. kafUSD and stKLD are ERC20s the wallet holds and would
 * otherwise appear in Wallet as well as in their own group; `WALLET_EXCLUDES`
 * drops them from Wallet, where the group that explains what they *are* keeps
 * them. Everything else in the protocol — collateral, an offer's principal, a
 * funded loan — is held by a contract and never by the wallet, so those cannot
 * collide by construction.
 *
 * WHAT A SUBTOTAL MEANS
 *
 * `subtotalUsd` is the group's contribution to `netValue`, which is why the
 * Borrowing group's is net of debt and can be negative. Uniform definition, one
 * addition at the end, and no group whose figure means something different from
 * its neighbour's.
 *
 * TWO PRICE SOURCES, DELIBERATELY SPLIT
 *
 * Debt and collateral are valued by the DIAMOND's own oracle (`getUsdValue`),
 * because those are the figures the liquidation engine acts on — a portfolio that
 * priced them from a market feed would put a health factor next to a collateral
 * value that does not produce it. Everything else is valued from
 * `/api/prices/spot` via `useSpotPrices`, which is the app's browser-side price
 * authority and the reason /pool and /leaderboard cannot show two ETH prices.
 * The two agree to within a feed's spread, and where they cannot, the strip's
 * Collateral and Borrowed figures are the protocol's opinion by design.
 *
 * AN UNPRICED POSITION IS NOT A WORTHLESS ONE
 *
 * The priceable table is eight symbols (ETH, WETH, USDC, USDT, BNB, USDR, kfUSD,
 * kafUSD). A wallet holding WBTC or KLD holds something real that cannot be
 * summed, so a row keeps its amount and reports `valueUsd: null` — which the page
 * renders as an em dash on the row itself, the one place a reader is already
 * looking. Each group also carries an `unpriced` list of what its subtotal left
 * out, and that list is what raises `netValuePartial` for the total. Summing an
 * unpriced row as zero would understate a portfolio while looking like a
 * measurement — the one outcome this hook must never produce.
 */

export type PositionKind =
  | "wallet"
  | "collateral"
  | "debt"
  | "offer"
  | "loan"
  | "staking"
  | "liquidity"
  | "vault"
  | "yield";

export type StateTone = "ok" | "warn" | "bad";

export interface PositionState {
  tone: StateTone;
  text: string;
}

export interface Position {
  id: string;
  kind: PositionKind;
  /** Primary label, e.g. "ETH" or "KLD / USDC" */
  label: string;
  /** Secondary label, e.g. "Collateral" or "Liquidity · 0.30%" */
  sublabel: string;
  /** Human-readable token amount. Null where the position isn't denominated in one token. */
  amount: string | null;
  /** USD value. Null means genuinely unknown — render "—", never 0. */
  valueUsd: number | null;
  /** Annualised rate as a percentage, e.g. 14.2. Null where not applicable. */
  apy: number | null;
  state: PositionState;
}

export type GroupId = "wallet" | "lending" | "borrowing" | "stable" | "staking";

export interface PositionGroup {
  id: GroupId;
  title: string;
  /**
   * The group's contribution to `netValue`, in USD.
   *
   * Null means nothing in the group could be valued at all — not that it is
   * empty. An empty group is `0`, which is a measurement: the address holds
   * nothing here.
   */
  subtotalUsd: number | null;
  /**
   * Names of things the group holds that `subtotalUsd` could not include —
   * symbols with no feed, a pair whose decimals are unknown, a balance that could
   * not be read.
   *
   * Not rendered: the rows themselves already show an em dash where a value is
   * missing. This list is the machine-readable form of that, and what raises
   * `netValuePartial`. Never let a row leave the list silently — a group that
   * drops an unpriced holding reports a subtotal that is wrong rather than short.
   */
  unpriced: string[];
  rows: Position[];
  /** Copy for the group's empty state. */
  empty: string;
  /** Where this group's product lives, for the empty state's call to action. */
  href: string;
}

export type AlertSeverity = "critical" | "warning" | "info";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  href?: string;
}

export interface Portfolio {
  /** Sum of the five group subtotals. Null until something is measurable. */
  netValue: number | null;
  /**
   * True when at least one position could not be priced, so `netValue` is a
   * floor rather than a total.
   *
   * /portfolio carries it as the headline figure's tooltip and nothing louder —
   * body copy explaining a caveat under the number reads as an apology for the
   * page. What a subtotal left out is named per group instead, next to the rows
   * it was left out of, where it is a fact about those rows rather than a
   * disclaimer about the product.
   */
  netValuePartial: boolean;
  collateralUsd: number | null;
  debtUsd: number | null;
  /** Health factor. Infinity when there is no debt. Null while unknown. */
  health: number | null;
  unclaimedYieldUsd: number | null;
  groups: PositionGroup[];
  /** Sorted most urgent first. */
  alerts: Alert[];
  isLoading: boolean;
}

/** Health factor below which we surface a liquidation warning. */
const HEALTH_WARN = 1.25;
const HEALTH_CRITICAL = 1.1;

/** Contract health factors are 1e18-scaled, per the dashboard's own maths. */
const HEALTH_SCALE = 1e-18;

/**
 * getUsdValue returns USD at 18 decimals.
 *
 * This was 1e16, which was correct against the old contract: getUsdValue
 * inverted the Pyth exponent conversion, so its output carried 10**(-2*expo)
 * — 1e16 for the -8 feeds in use. ProtocolFacet._priceScaled18 now normalises to
 * a fixed 18-decimal scale whatever the feed's exponent, so the divisor is 1e18
 * and no longer silently wrong for a feed that isn't -8.
 */
const USD_SCALE = 1e18;

/**
 * Tokens the Wallet group does not list, because another group owns them.
 *
 * Both are plain transferable ERC20s, so `useWalletBalances` finds them the same
 * way it finds USDC — and a kafUSD balance shown once under Wallet and again
 * under Stable is the same dollar counted twice in `netValue`.
 */
const WALLET_EXCLUDES = new Set(["kafUSD", "stKLD"]);

/** Parses useStablecoin's pre-formatted "$1,234.56" reward string. */
const parseUsdString = (value: string | undefined): number => {
  if (!value) return 0;
  const n = parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Base units → human units, or null when the token's decimals are unknown. */
const humanAmount = (
  raw: string,
  decimals: number | undefined,
): number | null => {
  if (decimals === undefined) return null;
  try {
    const n = Number(ethers.formatUnits(raw, decimals));
    return Number.isFinite(n) ? n : null;
  } catch {
    /* A non-numeric string from the mirror. Unknown, not zero. */
    return null;
  }
};

/** Unix seconds → days from now, negative once past. */
const daysUntil = (unixSeconds: number): number =>
  (unixSeconds * 1000 - Date.now()) / 86_400_000;

/**
 * Sum the rows a group can price, and record the ones it cannot.
 *
 * A partial sum is published rather than null, on the condition that the excluded
 * rows are accounted for — which is what `unpriced` is for. The alternative,
 * nulling a whole group because one of its six rows has no feed, hides five
 * measured figures to avoid overstating a sixth.
 */
const sumRows = (
  rows: Position[],
): { subtotalUsd: number | null; unpriced: string[] } => {
  if (rows.length === 0) return { subtotalUsd: 0, unpriced: [] };
  let total = 0;
  let priced = 0;
  const unpriced: string[] = [];
  for (const r of rows) {
    if (r.valueUsd === null || !Number.isFinite(r.valueUsd)) {
      unpriced.push(r.label);
      continue;
    }
    total += r.valueUsd;
    priced += 1;
  }
  return { subtotalUsd: priced === 0 ? null : total, unpriced };
};

const toneForHealth = (health: number | null): StateTone => {
  if (health === null) return "ok";
  if (health < HEALTH_CRITICAL) return "bad";
  if (health < HEALTH_WARN) return "warn";
  return "ok";
};

export const usePortfolio = (): Portfolio => {
  const activeAccount = useActiveAccount();
  const address = activeAccount?.address;
  const walletChainId = useActiveWalletChain()?.id;

  /*
   * Two resolvers, and keeping them apart is a fix rather than a flourish.
   *
   * A token address means nothing without the chain it lives on, and this hook
   * reads two different chains: `useGetValueAndHealth`, `useGetActiveRequest` and
   * `useLenderPositions` all describe READ_ONLY_CHAIN_ID, while
   * `useWalletBalances` and `useV3Positions` describe whichever chain the wallet
   * is on. A single `symbolFor(chainId)` bound to the wallet's chain — which is
   * what this hook used to have — rendered every debt row as `0x1234…abcd` for
   * anyone connected to a chain other than the read chain, because it was
   * resolving read-chain addresses against the wrong table.
   */
  const protocolSymbol = (a: string | undefined) =>
    symbolForAddress(READ_ONLY_CHAIN_ID, a);
  const protocolDecimals = (a: string | undefined) =>
    decimalsForAddress(READ_ONLY_CHAIN_ID, a);
  const walletSymbol = (a: string | undefined) =>
    symbolForAddress(walletChainId, a);

  const {
    data,
    data2,
    collateralVal,
    AVA,
    AVA2,
    AVA4,
    AVA5,
    userstKldBalance,
  } = useGetValueAndHealth();

  const { requests: activeReq } = useGetActiveRequest();
  const {
    balances,
    userRewards,
    withdrawalInfo,
    stats,
    isLoading: stableLoading,
  } = useStablecoin();
  const { positions: v3Positions, loading: v3Loading } = useV3Positions();
  const {
    offers,
    loans: fundedLoans,
    loading: lenderLoading,
  } = useLenderPositions();
  const {
    holdings,
    unread: unreadHoldings,
    loading: walletLoading,
  } = useWalletBalances();
  const { priceOf, loading: pricesLoading } = useSpotPrices();

  /*
   * Debt, priced by the diamond, per request and in total.
   *
   * Mirrors the calculation in components/dashboard/Usage.tsx so the two screens
   * cannot disagree about what the user owes. Kept per-request as well as summed
   * so a debt ROW carries the same oracle's number as the Borrowed strip above
   * it: pricing the rows from spot instead would leave a column that does not add
   * up to its own total.
   */
  const [debt, setDebt] = useState<{
    byId: Record<string, number>;
    total: number | null;
  }>({ byId: {}, total: null });

  useEffect(() => {
    let cancelled = false;

    const priceDebt = async () => {
      if (!address) {
        setDebt({ byId: {}, total: null });
        return;
      }

      const open =
        activeReq?.filter((req) => Number(req.totalRepayment) > 0) ?? [];
      if (!open.length) {
        setDebt({ byId: {}, total: 0 });
        return;
      }

      try {
        const contract = getKaleidoContract(
          readOnlyProvider,
          READ_ONLY_CHAIN_ID,
        );
        const priced = await Promise.all(
          open.map(async (req, i) => {
            const unitUsd = await contract.getUsdValue(req.tokenAddress, 1, 0);
            /*
             * `totalRepayment` is ALREADY decimal-adjusted here.
             *
             * This producer is useGetActiveRequest, which runs the contract's
             * raw value through formatUnits itself (:44) — unlike /api/requests,
             * which serves base units as text. Formatting it a second time threw
             * `invalid BigNumberish string: Cannot convert 3.7135 to a BigInt`,
             * so Promise.all rejected, the catch below set the total to null, and
             * because a null total feeds `isLoading`, /portfolio spun forever for
             * anyone holding a loan.
             */
            const owed = Number(req.totalRepayment);
            const usd = Number.isFinite(owed)
              ? (Number(unitUsd) * owed) / USD_SCALE
              : 0;
            return [String(req.requestId ?? i), usd] as const;
          }),
        );
        if (cancelled) return;
        const byId: Record<string, number> = {};
        let total = 0;
        for (const [id, usd] of priced) {
          byId[id] = usd;
          total += usd;
        }
        setDebt({ byId, total });
      } catch {
        if (!cancelled) setDebt({ byId: {}, total: null });
      }
    };

    priceDebt();
    return () => {
      cancelled = true;
    };
  }, [address, activeReq]);

  const debtUsd = debt.total;

  // --- Health -----------------------------------------------------------
  const health = useMemo<number | null>(() => {
    if (!address) return null;
    // No open requests means nothing can be liquidated.
    if (Array.isArray(data) && data.length === 0) return Infinity;
    if (data2 === undefined || data2 === null) return null;
    /* Infinity is the contract's "no debt" sentinel, already recognised on the
       bigint by useGetValueAndHealth — pass it through rather than letting the
       finiteness guard below turn it into "—". It reaches here for a wallet that
       holds collateral but has borrowed nothing: `data` is non-empty, so the
       short-circuit above does not catch that case, and before the sentinel was
       handled at all this line rendered 1.157920892373162e+59 — 2^256 / 1e18. */
    if (data2 === Infinity) return Infinity;
    const h = Number(data2) * HEALTH_SCALE;
    return Number.isFinite(h) ? h : null;
  }, [address, data, data2]);

  const collateralUsd = useMemo<number | null>(() => {
    if (!address) return null;
    /*
     * `Number(null)` is 0, not NaN, so the Number.isFinite test below passed for
     * an unread atom and published $0.00 as though it had been measured — both
     * before the first read completes (collateralValAtom starts null) and
     * whenever useGetValueAndHealth declines to publish a partial total. An
     * empty string has the same problem: Number("") is 0.
     */
    if (
      collateralVal === null ||
      collateralVal === undefined ||
      collateralVal === ""
    ) {
      return null;
    }
    const v = Number(collateralVal);
    return Number.isFinite(v) ? v : null;
  }, [address, collateralVal]);

  const unclaimedYieldUsd = useMemo<number | null>(() => {
    if (!address) return null;
    return parseUsdString(userRewards?.totalRewards);
  }, [address, userRewards]);

  // --- Wallet -----------------------------------------------------------
  const walletGroup = useMemo<PositionGroup>(() => {
    const rows: Position[] = holdings
      .filter((h) => !WALLET_EXCLUDES.has(h.symbol))
      .map((h) => {
        const price = priceOf(h.symbol);
        return {
          id: `wallet-${h.address}`,
          kind: "wallet" as const,
          label: h.symbol,
          sublabel: h.isNative ? "Native balance" : "Wallet balance",
          amount: shortAmount(h.value, h.amount),
          valueUsd: price === null ? null : h.value * price,
          apy: null,
          state: { tone: "ok" as StateTone, text: "Idle" },
        };
      })
      /* Largest first: a wallet with twenty rows is read from the top, and the
         registry's own order is alphabetical-by-chain-table, which buries the
         holding that matters. Unpriced rows sort last rather than as zero. */
      .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

    const { subtotalUsd, unpriced } = sumRows(rows);
    return {
      id: "wallet",
      title: "Wallet",
      subtotalUsd,
      /* A balance that could not be READ is a different caveat from one that
         could not be PRICED, and both belong here — the subtotal is missing it
         either way, and the reader needs to know the figure is short. */
      unpriced: [...unpriced, ...unreadHoldings],
      rows,
      empty: "No token balances on this network.",
      href: "/trade/swap",
    };
  }, [holdings, unreadHoldings, priceOf]);

  // --- Lending ----------------------------------------------------------
  const lendingGroup = useMemo<PositionGroup>(() => {
    const rows: Position[] = [];

    fundedLoans.forEach((l) => {
      const symbol = protocolSymbol(l.tokenAddress);
      const decimals = protocolDecimals(l.tokenAddress);
      const outstanding = humanAmount(l.outstanding, decimals);
      const price = priceOf(symbol);
      const overdue = daysUntil(l.returnDate) < 0;
      rows.push({
        id: `loan-${l.requestId}`,
        kind: "loan",
        label: symbol,
        sublabel: "Lent · P2P",
        amount: outstanding === null ? null : shortAmount(outstanding, "—"),
        valueUsd:
          outstanding === null || price === null ? null : outstanding * price,
        apy: convertbasisPointsToPercentage(l.interestBps),
        state: overdue
          ? { tone: "bad", text: "Past due" }
          : { tone: "ok", text: "Repaying" },
      });
    });

    offers.forEach((o) => {
      const symbol = protocolSymbol(o.tokenAddress);
      const decimals = protocolDecimals(o.tokenAddress);
      const amount = humanAmount(o.amount, decimals);
      const price = priceOf(symbol);
      /* An offer past its own return date can no longer be drawn on for a full
         term, which /mylends already badges as overdue. `returnDate` is 0 when
         unset, and 0 is not "1970" — it is "no date", so it must not read as
         expired. */
      const expired = o.returnDate > 0 && daysUntil(o.returnDate) < 0;
      rows.push({
        id: `offer-${o.listingId}`,
        kind: "offer",
        label: symbol,
        sublabel: "Offer · unfilled",
        amount: amount === null ? null : shortAmount(amount, "—"),
        valueUsd: amount === null || price === null ? null : amount * price,
        apy: convertbasisPointsToPercentage(o.interestBps),
        /* Not "ok" even when live: an unfilled offer is capital sitting in the
           protocol earning nothing, which is a state a lender may want to act
           on. */
        state: expired
          ? { tone: "bad", text: "Expired" }
          : { tone: "warn", text: "Awaiting a borrower" },
      });
    });

    const { subtotalUsd, unpriced } = sumRows(rows);
    return {
      id: "lending",
      title: "Lending",
      subtotalUsd,
      unpriced,
      rows,
      empty: "No offers posted and no loans funded.",
      href: "/lend",
    };
    /* The two resolvers above are absent from these deps on purpose: both close
       over READ_ONLY_CHAIN_ID, a module constant, so a new function identity each
       render carries no new information. `priceOf` is likewise rebuilt every
       render by design (see useSpotPrices) — these memos are a few dozen rows of
       mapping, and chasing referential stability through them would cost more
       than it saves. */
  }, [offers, fundedLoans, priceOf]);

  // --- Borrowing --------------------------------------------------------
  const borrowingGroup = useMemo<PositionGroup>(() => {
    // USDR is absent, deliberately: it has no deployment on any live chain, so
    // useGetValueAndHealth no longer reads it and the AVA3 atom it fed is gone.
    // The row was unreachable anyway — the filter below drops anything at zero.
    const collateralTokens: Array<[string, unknown]> = [
      ["ETH", AVA],
      ["USDC", AVA2],
      ["kfUSD", AVA4],
      ["USDT", AVA5],
    ];

    const rows: Position[] = collateralTokens
      .filter(([, amount]) => Number(amount) > 0)
      .map(([symbol, amount]) => ({
        id: `collateral-${symbol}`,
        kind: "collateral" as const,
        label: symbol,
        sublabel: "Collateral",
        amount: String(amount),
        /* Per-token USD is not exposed by the contract — only the aggregate
           (`collateralVal`) is, and that aggregate is what the group's subtotal
           uses. Pricing these rows from spot instead would produce a column
           whose sum contradicts both the strip above it and the health factor
           the protocol derives from its own oracle. */
        valueUsd: null,
        apy: null,
        state: { tone: toneForHealth(health), text: "Deposited" },
      }));

    const open =
      activeReq?.filter((req) => Number(req.totalRepayment) > 0) ?? [];
    open.forEach((req, i) => {
      const id = String(req.requestId ?? i);
      const dueInDays = req.returnDate ? daysUntil(Number(req.returnDate)) : NaN;
      rows.push({
        id: `debt-${id}`,
        kind: "debt",
        label: protocolSymbol(req.tokenAddress),
        sublabel: "Borrowed · P2P",
        // Already formatted by useGetActiveRequest — see the note in priceDebt.
        // Running it through formatUnits again threw, and the catch rendered
        // every debt row's amount as "—".
        amount: String(req.totalRepayment),
        /* Negative: this row is a liability, and `netValue` is one addition over
           every group's subtotal. A debt carried as a positive number would have
           to be subtracted somewhere else, which is where sign errors live. */
        valueUsd: debt.byId[id] === undefined ? null : -debt.byId[id],
        // `interest` is basis points straight off the contract — useBorrowV2
        // names the same field interestBps. Position.apy is documented as a
        // percentage, so a 10% loan was rendering as "1000.00%".
        apy:
          req.interest !== undefined
            ? convertbasisPointsToPercentage(Number(req.interest))
            : null,
        state:
          Number.isFinite(dueInDays) && dueInDays < 0
            ? { tone: "bad", text: "Past due" }
            : { tone: "warn", text: "Outstanding" },
      });
    });

    /*
     * The one group whose subtotal is not a sum of its rows.
     *
     * Collateral rows carry no USD (see above), so summing them would report a
     * wallet's whole deposit as unpriced. The protocol's own aggregate is both
     * available and authoritative here, so the subtotal is that aggregate minus
     * the debt the same oracle priced — the group's true contribution to net
     * value, and negative for a wallet that has borrowed more than it has
     * deposited at par.
     */
    const unpriced: string[] = [];
    let subtotalUsd: number | null = null;
    const hasCollateral = rows.some((r) => r.kind === "collateral");
    const hasDebt = open.length > 0;

    if (!hasCollateral && !hasDebt) {
      subtotalUsd = 0;
    } else {
      const c = hasCollateral ? collateralUsd : 0;
      const d = hasDebt ? debtUsd : 0;
      if (c === null) unpriced.push("collateral");
      if (d === null) unpriced.push("debt");
      subtotalUsd = c === null || d === null ? null : c - d;
    }

    return {
      id: "borrowing",
      title: "Borrowing",
      subtotalUsd,
      unpriced,
      rows,
      empty: "No collateral deposited and nothing borrowed.",
      href: "/borrow",
    };
  }, [
    AVA,
    AVA2,
    AVA4,
    AVA5,
    activeReq,
    debt.byId,
    debtUsd,
    collateralUsd,
    health,
  ]);

  // --- Stable -----------------------------------------------------------
  const stableGroup = useMemo<PositionGroup>(() => {
    const rows: Position[] = [];

    const kafUsd = Number(balances?.kafUSD ?? 0);
    if (kafUsd > 0) {
      rows.push({
        id: "vault-kafusd",
        kind: "vault",
        label: "kafUSD",
        sublabel: "Yield vault",
        amount: shortAmount(kafUsd, balances.kafUSD),
        /* Dollar-denominated, so 1:1 — and the same assumption the price table
           itself makes (`ASSUMED_PAR` in lib/points/prices.ts), rather than a
           second, private one invented here. */
        valueUsd: kafUsd,
        apy: stats?.totalYieldAPY ? parseFloat(stats.totalYieldAPY) : null,
        state: !withdrawalInfo?.hasWithdrawal
          ? { tone: "ok", text: "Earning" }
          : // `unlockTime` carries the literal "Ready" once the notice is up, so
            // interpolating it unconditionally read "Unlocks Ready".
            withdrawalInfo.isReady
            ? { tone: "warn", text: "Ready to withdraw" }
            : { tone: "warn", text: `Unlocks in ${withdrawalInfo.unlockTime}` },
      });
    }

    /*
     * Unclaimed yield is its own row, not part of the vault's.
     *
     * kafUSD is counted at par and the rewards are held separately by the yield
     * treasury until `claimYield` moves them, so these are two different
     * balances rather than one figure viewed twice. It is also the only row on
     * this page that represents money the user has to press a button to keep.
     */
    if ((unclaimedYieldUsd ?? 0) > 0) {
      rows.push({
        id: "yield-unclaimed",
        kind: "yield",
        label: "Yield",
        sublabel: "Unclaimed · kafUSD vault",
        amount: null,
        valueUsd: unclaimedYieldUsd,
        apy: null,
        state: { tone: "warn", text: "Ready to claim" },
      });
    }

    const { subtotalUsd, unpriced } = sumRows(rows);
    return {
      id: "stable",
      title: "Stable",
      subtotalUsd,
      unpriced,
      rows,
      empty: "No kfUSD minted and nothing in the vault.",
      href: "/stable",
    };
  }, [balances, stats, withdrawalInfo, unclaimedYieldUsd]);

  // --- Staking & LP -----------------------------------------------------
  const stakingGroup = useMemo<PositionGroup>(() => {
    const rows: Position[] = [];

    const stKld = Number(userstKldBalance ?? 0);
    if (stKld > 0) {
      const price = priceOf("stKLD");
      rows.push({
        id: "staking-stkld",
        kind: "staking",
        label: "stKLD",
        sublabel: "Liquid staking",
        amount: shortAmount(stKld, String(userstKldBalance)),
        /* Null before TGE, and that is the correct answer rather than a gap —
           KLD has no market, so nothing derived from it has a dollar value.
           `priceOf` is still consulted so the row prices itself the day a feed
           exists, without an edit here. */
        valueUsd: price === null ? null : stKld * price,
        apy: null,
        state: { tone: "ok", text: "Accruing" },
      });
    }

    v3Positions?.forEach((p) => {
      /* A fully-withdrawn position still exists as an NFT and may still hold
         uncollected fees, which is why it appears on /pool/positions. It holds
         no capital, so it contributes nothing here. */
      if (Number(p.liquidity) === 0) return;

      const symbol0 = walletSymbol(p.token0);
      const symbol1 = walletSymbol(p.token1);
      const decimals0 = decimalsForAddress(walletChainId, p.token0);
      const decimals1 = decimalsForAddress(walletChainId, p.token1);

      /*
       * No `?? 18` here, deliberately. Every other display path in this app may
       * guess decimals at the call site; this one may not, because the guess is
       * multiplied by a price. A 6-decimal leg read as 18 misprices the position
       * by 10^12 — a plausible-looking dollar figure a trillion times too small,
       * which is worse than an em dash by every measure.
       */
      const amounts =
        decimals0 === undefined || decimals1 === undefined
          ? null
          : positionAmounts({
              sqrtPriceX96: p.sqrtPriceX96,
              tickLower: p.tickLower,
              tickUpper: p.tickUpper,
              liquidity: p.liquidity,
              decimals0,
              decimals1,
            });

      const valueUsd = positionValueUsd(
        amounts,
        priceOf(symbol0),
        priceOf(symbol1),
      );

      rows.push({
        id: `liquidity-${p.tokenId}`,
        kind: "liquidity",
        label: `${symbol0} / ${symbol1}`,
        sublabel: `Liquidity · ${(Number(p.fee) / 10000).toFixed(2)}%`,
        amount: amounts
          ? `${shortAmount(amounts.amount0, "—")} ${symbol0} + ${shortAmount(
              amounts.amount1,
              "—",
            )} ${symbol1}`
          : null,
        valueUsd,
        apy: null,
        state: p.inRange
          ? { tone: "ok", text: "In range" }
          : { tone: "bad", text: "Out of range" },
      });
    });

    const { subtotalUsd, unpriced } = sumRows(rows);
    return {
      id: "staking",
      title: "Staking & LP",
      subtotalUsd,
      unpriced,
      rows,
      empty: "Nothing staked and no liquidity provided.",
      href: "/stake",
    };
  }, [userstKldBalance, v3Positions, walletChainId, priceOf]);

  const groups = useMemo<PositionGroup[]>(() => {
    if (!address) return [];
    return [
      walletGroup,
      lendingGroup,
      borrowingGroup,
      stableGroup,
      stakingGroup,
    ];
  }, [
    address,
    walletGroup,
    lendingGroup,
    borrowingGroup,
    stableGroup,
    stakingGroup,
  ]);

  // --- Derived totals ---------------------------------------------------
  const { netValue, netValuePartial } = useMemo(() => {
    if (!groups.length) return { netValue: null, netValuePartial: false };
    let total = 0;
    let measured = 0;
    let partial = false;
    for (const g of groups) {
      if (g.unpriced.length) partial = true;
      if (g.subtotalUsd === null) {
        /* A group that holds something unvaluable makes the total a floor, not
           an unknown — dropping four measured groups because the fifth has no
           feed would render "—" for a wallet whose position is mostly priced. */
        if (g.rows.length) partial = true;
        continue;
      }
      total += g.subtotalUsd;
      measured += 1;
    }
    return {
      netValue: measured === 0 ? null : total,
      netValuePartial: partial,
    };
  }, [groups]);

  // --- Attention --------------------------------------------------------
  const alerts = useMemo<Alert[]>(() => {
    if (!address) return [];
    const out: Alert[] = [];

    if (health !== null && Number.isFinite(health) && health < HEALTH_WARN) {
      const critical = health < HEALTH_CRITICAL;
      out.push({
        id: "health",
        severity: critical ? "critical" : "warning",
        title: critical
          ? "Position is close to liquidation"
          : "Health factor approaching the liquidation threshold",
        detail: `Health factor is ${health.toFixed(2)}. Liquidation occurs at 1.00 — repaying debt or adding collateral raises it.`,
        /* /myloans, not `/`. This was written when `/` 307'd into the app, so
           the link happened to land somewhere useful; `/` serves the marketing
           landing page now (see next.config.mjs), which means the one alert that
           can cost the user their collateral was sending them to a sales page.
           /myloans is BorrowBookView in `mine` mode — the Repay button that
           this detail line tells them to reach for is on it. */
        href: "/myloans",
      });
    }

    const pastDueDebt = borrowingGroup.rows.filter(
      (r) => r.kind === "debt" && r.state.text === "Past due",
    );
    if (pastDueDebt.length) {
      out.push({
        id: "debt-past-due",
        severity: "critical",
        title: `${pastDueDebt.length} loan${pastDueDebt.length > 1 ? "s" : ""} past the return date`,
        detail:
          "An overdue loan can be liquidated by its lender at any time. Repaying it releases the collateral behind it.",
        href: "/myloans",
      });
    }

    const pastDueLent = lendingGroup.rows.filter(
      (r) => r.kind === "loan" && r.state.text === "Past due",
    );
    if (pastDueLent.length) {
      out.push({
        id: "lent-past-due",
        severity: "warning",
        title: `${pastDueLent.length} loan${pastDueLent.length > 1 ? "s" : ""} you funded is overdue`,
        detail:
          "The borrower has passed the return date, so the collateral behind the loan can be claimed.",
        href: "/mylends",
      });
    }

    const outOfRange = stakingGroup.rows.filter(
      (r) => r.kind === "liquidity" && r.state.tone === "bad",
    );
    if (outOfRange.length) {
      out.push({
        id: "lp-out-of-range",
        severity: "warning",
        title: `${outOfRange.length} liquidity position${outOfRange.length > 1 ? "s" : ""} out of range`,
        detail:
          "Out-of-range liquidity earns no fees. Rebalance or withdraw to put the capital back to work.",
        /* /pool is the all-pools table now; the user's own positions — the ones
           this alert counted — are the tab below it. */
        href: "/pool/positions",
      });
    }

    if ((unclaimedYieldUsd ?? 0) > 0) {
      out.push({
        id: "unclaimed-yield",
        severity: "info",
        title: "Yield ready to claim",
        detail: `${userRewards?.totalRewards} available from the kafUSD vault.`,
        href: "/stable",
      });
    }

    const idleOffers = lendingGroup.rows.filter((r) => r.kind === "offer");
    if (idleOffers.length) {
      out.push({
        id: "offers-unfilled",
        severity: "info",
        title: `${idleOffers.length} offer${idleOffers.length > 1 ? "s" : ""} waiting for a borrower`,
        detail:
          "Capital in an unfilled offer earns nothing. Lowering the rate or the term makes it easier to fill.",
        href: "/mylends",
      });
    }

    const order: Record<AlertSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    return out.sort((a, b) => order[a.severity] - order[b.severity]);
  }, [
    address,
    health,
    borrowingGroup,
    lendingGroup,
    stakingGroup,
    unclaimedYieldUsd,
    userRewards,
  ]);

  return {
    netValue,
    netValuePartial,
    collateralUsd,
    debtUsd,
    health,
    unclaimedYieldUsd,
    groups,
    alerts,
    isLoading:
      Boolean(address) &&
      (stableLoading ||
        v3Loading ||
        lenderLoading ||
        walletLoading ||
        pricesLoading ||
        debtUsd === null),
    /*
     * Demo mode: the whole aggregate at once, rather than per-input.
     *
     * Several of this hook's sources are already mocked one level down
     * (useStablecoin, useV3Positions, useLenderPositions, useWalletBalances), but
     * the other two — useGetValueAndHealth and useGetActiveRequest — are legacy
     * hooks shared with the dashboard and the borrow modals, and mocking them
     * would reach much further than this page. So the aggregate is substituted
     * here instead, and src/lib/mock's portfolio fixture is derived from the same
     * product fixtures the rest of the app is showing, so /portfolio and /stable,
     * /stake, /pool/positions and /borrow all still agree with each other.
     *
     * Gated on a connected wallet, matching every other seam: with none, the
     * empty state is the real one. That also keeps the server pass honest —
     * `address` is undefined there, so the fixtures cannot render into the HTML
     * and mismatch on hydration. Delete with src/lib/mock.
     */
    ...(MOCK_DATA && address ? MOCK_PORTFOLIO : {}),
  };
};

export default usePortfolio;
