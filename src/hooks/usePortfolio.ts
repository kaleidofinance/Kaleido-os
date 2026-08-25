"use client";

import { useEffect, useMemo, useState } from "react";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";

import useGetValueAndHealth from "@/hooks/useGetValueAndHealth";
import useGetActiveRequest from "@/hooks/useGetActiveRequest";
import { useStablecoin } from "@/hooks/useStablecoin";
import { useV3Positions } from "@/hooks/dex/useV3Positions";
import { getKaleidoContract } from "@/config/contracts";
import { readOnlyProvider, READ_ONLY_CHAIN_ID } from "@/config/provider";
import { convertbasisPointsToPercentage } from "@/constants/utils/FormatInterestRate";
import { symbolForAddress } from "@/constants/tokens";
import { MOCK_DATA, MOCK_PORTFOLIO } from "@/lib/mock";

/**
 * usePortfolio — the unified view of everything an address holds.
 *
 * Kaleido's products each have their own hook, each reading a different
 * contract. Nothing joins them, so no screen can answer "what do I own"
 * without stitching four hooks together by hand. This does that stitching
 * once, and normalises the results onto a single Position shape.
 *
 * It is pure aggregation — no new contract calls beyond the debt pricing
 * that Usage.tsx already performs, and no writes. Existing hooks and
 * screens are untouched.
 */

export type PositionKind =
  "collateral" | "debt" | "staking" | "liquidity" | "vault";

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

export type AlertSeverity = "critical" | "warning" | "info";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  href?: string;
}

export interface Portfolio {
  /** Collateral + earning, minus debt. Null until enough inputs have loaded. */
  netValue: number | null;
  collateralUsd: number | null;
  debtUsd: number | null;
  /** Health factor. Infinity when there is no debt. Null while unknown. */
  health: number | null;
  unclaimedYieldUsd: number | null;
  borrowing: Position[];
  earning: Position[];
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

/** Parses useStablecoin's pre-formatted "$1,234.56" reward string. */
const parseUsdString = (value: string | undefined): number => {
  if (!value) return 0;
  const n = parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
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
  const chainId = useActiveWalletChain()?.id;

  /*
   * Resolves a token address to its symbol. Neither V3Position nor Request
   * carries one — both store raw addresses — so we look it up rather than show
   * an address. Bound to the connected chain: the same address is a different
   * token elsewhere, and an unregistered one falls back to `0x1234…abcd`.
   */
  const symbolFor = (tokenAddress: string | undefined): string =>
    symbolForAddress(chainId, tokenAddress);

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

  const [debtUsd, setDebtUsd] = useState<number | null>(null);

  // --- Debt -------------------------------------------------------------
  // Mirrors the calculation in components/dashboard/Usage.tsx so the two
  // screens can't disagree about what the user owes.
  useEffect(() => {
    let cancelled = false;

    const priceDebt = async () => {
      if (!address) {
        setDebtUsd(null);
        return;
      }

      const open =
        activeReq?.filter((req) => Number(req.totalRepayment) > 0) ?? [];
      if (!open.length) {
        setDebtUsd(0);
        return;
      }

      try {
        const contract = getKaleidoContract(
          readOnlyProvider,
          READ_ONLY_CHAIN_ID,
        );
        const values = await Promise.all(
          open.map(async (req) => {
            const unitUsd = await contract.getUsdValue(req.tokenAddress, 1, 0);
            /*
             * `totalRepayment` is ALREADY decimal-adjusted here.
             *
             * This producer is useGetActiveRequest, which runs the contract's
             * raw value through formatUnits itself (:44) — unlike /api/requests,
             * which serves base units as text. Formatting it a second time threw
             * `invalid BigNumberish string: Cannot convert 3.7135 to a BigInt`,
             * so Promise.all rejected, the catch below set debtUsd to null, and
             * because `debtUsd === null` feeds `isLoading`, /portfolio spun
             * forever for anyone holding a loan.
             */
            const owed = Number(req.totalRepayment);
            if (!Number.isFinite(owed)) return 0;
            return Number(unitUsd) * owed;
          }),
        );
        if (cancelled) return;
        setDebtUsd(values.reduce((acc, v) => acc + v, 0) / USD_SCALE);
      } catch {
        if (!cancelled) setDebtUsd(null);
      }
    };

    priceDebt();
    return () => {
      cancelled = true;
    };
  }, [address, activeReq]);

  // --- Health -----------------------------------------------------------
  const health = useMemo<number | null>(() => {
    if (!address) return null;
    // No open requests means nothing can be liquidated.
    if (Array.isArray(data) && data.length === 0) return Infinity;
    if (data2 === undefined || data2 === null) return null;
    const h = Number(data2) * HEALTH_SCALE;
    return Number.isFinite(h) ? h : null;
  }, [address, data, data2]);

  // --- Borrowing --------------------------------------------------------
  const borrowing = useMemo<Position[]>(() => {
    if (!address) return [];

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
        // Per-token USD isn't exposed by the contract — only the aggregate
        // (collateralVal) is. Splitting it would require pricing each token
        // separately; until then, don't invent a number.
        valueUsd: null,
        apy: null,
        state: { tone: "ok" as StateTone, text: "Deposited" },
      }));

    const open =
      activeReq?.filter((req) => Number(req.totalRepayment) > 0) ?? [];
    open.forEach((req, i) => {
      rows.push({
        id: `debt-${req.requestId ?? i}`,
        kind: "debt",
        label: symbolFor(req.tokenAddress),
        sublabel: "Borrowed · P2P",
        // Already formatted by useGetActiveRequest — see the note in priceDebt.
        // Running it through formatUnits again threw, and the catch rendered
        // every debt row's amount as "—".
        amount: String(req.totalRepayment),
        valueUsd: null,
        // `interest` is basis points straight off the contract — useBorrowV2
        // names the same field interestBps. Position.apy is documented as a
        // percentage, so a 10% loan was rendering as "1000.00%".
        apy:
          req.interest !== undefined
            ? convertbasisPointsToPercentage(Number(req.interest))
            : null,
        state: { tone: "warn", text: "Outstanding" },
      });
    });

    return rows;
  }, [address, AVA, AVA2, AVA4, AVA5, activeReq, chainId]);

  // --- Earning ----------------------------------------------------------
  const earning = useMemo<Position[]>(() => {
    if (!address) return [];
    const rows: Position[] = [];

    const stKld = Number(userstKldBalance ?? 0);
    if (stKld > 0) {
      rows.push({
        id: "staking-stkld",
        kind: "staking",
        label: "stKLD",
        sublabel: "Liquid staking",
        amount: String(userstKldBalance),
        valueUsd: null, // needs a KLD price feed
        apy: null,
        state: { tone: "ok", text: "Accruing" },
      });
    }

    v3Positions?.forEach((p) => {
      if (Number(p.liquidity) === 0) return;
      rows.push({
        id: `liquidity-${p.tokenId}`,
        kind: "liquidity",
        label: `${symbolFor(p.token0)} / ${symbolFor(p.token1)}`,
        sublabel: `Liquidity · ${(Number(p.fee) / 10000).toFixed(2)}%`,
        amount: null,
        // Valuing a concentrated position means converting liquidity + the
        // current tick into token amounts, then pricing both. That's real
        // work and belongs in its own hook — see the note below.
        valueUsd: null,
        apy: null,
        state: p.inRange
          ? { tone: "ok", text: "In range" }
          : { tone: "bad", text: "Out of range" },
      });
    });

    const kafUsd = Number(balances?.kafUSD ?? 0);
    if (kafUsd > 0) {
      rows.push({
        id: "vault-kafusd",
        kind: "vault",
        label: "kafUSD",
        sublabel: "Yield vault",
        amount: balances.kafUSD,
        valueUsd: kafUsd, // dollar-denominated, so 1:1
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

    return rows;
  }, [
    address,
    userstKldBalance,
    v3Positions,
    balances,
    stats,
    withdrawalInfo,
    chainId,
  ]);

  // --- Derived totals ---------------------------------------------------
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

  const netValue = useMemo<number | null>(() => {
    if (collateralUsd === null) return null;
    const vaultValue = earning.reduce((acc, p) => acc + (p.valueUsd ?? 0), 0);
    return collateralUsd + vaultValue - (debtUsd ?? 0);
  }, [collateralUsd, earning, debtUsd]);

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

    const outOfRange = earning.filter(
      (p) => p.kind === "liquidity" && p.state.tone === "bad",
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

    const order: Record<AlertSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    return out.sort((a, b) => order[a.severity] - order[b.severity]);
  }, [address, health, earning, unclaimedYieldUsd, userRewards]);

  return {
    netValue,
    collateralUsd,
    debtUsd,
    health,
    unclaimedYieldUsd,
    borrowing,
    earning,
    alerts,
    isLoading:
      Boolean(address) && (stableLoading || v3Loading || debtUsd === null),
    /*
     * Demo mode: the whole aggregate at once, rather than per-input.
     *
     * Two of this hook's four sources are already mocked one level down
     * (useStablecoin, useV3Positions), but the other two — useGetValueAndHealth
     * and useGetActiveRequest — are legacy hooks shared with the dashboard and
     * the borrow modals, and mocking them would reach much further than this
     * page. So the aggregate is substituted here instead, and src/lib/mock's
     * portfolio fixture is derived from the same product fixtures the rest of
     * the app is showing, so /portfolio and /stable, /stake, /pool/positions and
     * /borrow all still agree with each other.
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
