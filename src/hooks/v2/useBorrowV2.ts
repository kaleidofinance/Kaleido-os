"use client";

import { useCallback, useMemo } from "react";
import { ethers } from "ethers";
import { toast } from "sonner";
import { useActiveWalletChain } from "thirdweb/react";
import useCreateLoanListing from "@/hooks/useCreateLoanListing";
import useCreateLendingRequest from "@/hooks/useCreateLendingRequest";
import useAcceptListedAds from "@/hooks/useAcceptListedAds";
import useRepayLoan from "@/hooks/useRepayLoan";
import useDepositCollateral from "@/hooks/useDepositCollateral";
import useDepositNativeCollateral from "@/hooks/useDepositNativeColateral";
import useWithdrawCollateral from "@/hooks/useWithdrawCollateral";
import useGetActiveRequest from "@/hooks/useGetActiveRequest";
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth";
import useLendingAssets from "@/hooks/useLendingAssets";
import useLendingFees, { type LendingFees } from "@/hooks/useLendingFees";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";
import { READ_ONLY_CHAIN_ID } from "@/config/provider";
import { declaredSymbol, type BorrowCurrency } from "@/constants/registry";
import type { CollateralHolding, LendingAsset } from "@/lib/lending/assets";
import { lendingChainMismatch } from "@/lib/lending/chain";
import {
  MOCK_COLLATERAL,
  MOCK_DATA,
  MOCK_LOANS,
  MOCK_PORTFOLIO,
} from "@/lib/mock";

/**
 * Bridge hook for the v2 Borrow surface.
 *
 * Same job as useStakeV2: wrap the legacy loan hooks into one typed shape so
 * v2 pages never touch `data`/`AVA`/raw wei. Every action here passes an
 * onSuccess callback, which is what keeps v2 inside its own shell — the legacy
 * hooks otherwise router.push() to "/" or "/successful" mid-flow.
 *
 * It is also the one place the lending chain is enforced. Reads were already
 * pinned to it (useGetValueAndHealth) while writes went to whatever chain the
 * wallet was on, so a deposit on Base Sepolia landed in Base's diamond and the
 * health factor next to it came from Sepolia's — two deployments, one screen, no
 * error. Every action below refuses on a mismatch instead. See
 * src/lib/lending/chain.ts for why lending is single-chain today.
 */

// Only the type is re-exported. The table itself was `BORROW_CURRENCIES`, a flat
// Abstract-testnet list; it became `borrowCurrencies(chainId)` in the registry,
// and the pickers now read the diamond's own getters through useLendingAssets
// rather than either of them. The type stays for callers naming a symbol.
export type { BorrowCurrency };
/* Canonical in src/lib/lending/assets.ts — useLendingAssets produces these and
   this hook republishes them, so the type cannot live in either hook. */
export type { CollateralHolding, LendingAsset };

/**
 * Contract health factors are PRECISION-scaled (1e18), per ProtocolFacet's
 * getHealthFactor. usePortfolio already applies this; this hook did not, so the
 * Borrow/Lend card rendered ~1.03e18 for a health factor of 1.03 and its
 * `< 1.2` danger styling could never fire.
 */
const HEALTH_SCALE = 1e-18;

export interface ActiveLoan {
  requestId: number;
  amount: string;
  /** Human-readable, already decimal-adjusted. */
  totalRepayment: string;
  /** Raw base units — what repay() must be handed. */
  totalRepaymentRaw: string;
  interestBps: number;
  returnDate: number;
  lender: string;
  tokenAddress: string;
  symbol: string;
  status: string;
  overdue: boolean;
}

export interface BorrowV2 {
  loans: ActiveLoan[];
  collateral: CollateralHolding[];
  /**
   * What the diamond itself accepts, per side. Not what the registry lists —
   * see useLendingAssets. `error` is non-null when the read failed, and callers
   * must disable their submit rather than fall back to an offered list.
   */
  assets: {
    collateral: LendingAsset[];
    loanable: LendingAsset[];
    loading: boolean;
    error: string | null;
  };
  collateralValueUsd: number;
  /**
   * What the protocol charges, read from the diamond that charges it.
   *
   * Threaded through here rather than read in each surface so the four modals and
   * the book share one pair of calls — and so a fee shown next to a position is
   * necessarily the fee for the same deployment that position lives in.
   */
  fees: LendingFees;
  /** Contract health factor. Null when nothing is borrowed. */
  healthFactor: number | null;
  postOffer: (p: PostOfferParams) => Promise<void>;
  postRequest: (p: PostRequestParams) => Promise<void>;
  takeLoan: (p: TakeLoanParams) => Promise<void>;
  repay: (loan: ActiveLoan) => Promise<void>;
  depositCollateral: (amount: string, asset: LendingAsset) => Promise<void>;
  withdrawCollateral: (amount: string, asset: LendingAsset) => Promise<void>;
  /** Re-read collateral + health after a position-changing action. */
  refreshPosition: () => void;
  /** Re-read the active-loan list after a repay/take-loan. */
  refreshLoans: () => void;
}

/*
 * The asset every action carries is a `LendingAsset` — address AND decimals —
 * rather than a symbol, and that is the whole point of the change.
 *
 * A symbol forced each write hook to resolve the address and the decimals for
 * itself, and all six did it with an if-chain over Abstract-testnet literals
 * plus a hardcoded `decimals = 6; if (symbol === "kfUSD") decimals = 18`. On the
 * deployed chains no branch matched: `currency` stayed undefined and the ERC20
 * paths threw before sending anything. `useAcceptListedAds` had the same shape as
 * a one-liner — `tokenType === "ETH" ? 18 : 6` — which is a decimals inferred
 * from a symbol, exactly what rule 2 in constants/registry.ts forbids, and it
 * under-borrowed by 1e12 for any 18-decimal asset that was not called ETH.
 *
 * Passing the resolved asset down means there is one resolution, it happens where
 * the list came from (the diamond), and a hook cannot disagree with the picker
 * that fed it.
 */
export interface PostOfferParams {
  amount: string;
  minAmount: number;
  maxAmount: number;
  /** Unix seconds. */
  returnDate: number;
  interest: number;
  asset: LendingAsset;
  onSuccess?: () => void;
}

export interface PostRequestParams {
  amount: string;
  interest: number;
  returnDate: number;
  asset: LendingAsset;
  onSuccess?: () => void;
}

export interface TakeLoanParams {
  listingId: number;
  amount: string;
  asset: LendingAsset;
  onSuccess?: () => void;
}

export const useBorrowV2 = (): BorrowV2 => {
  const activeChain = useActiveWalletChain();
  const createListing = useCreateLoanListing();
  const createRequest = useCreateLendingRequest();
  const acceptListing = useAcceptListedAds();
  const repayLoan = useRepayLoan();
  const depositErc20 = useDepositCollateral();
  const depositNative = useDepositNativeCollateral();
  const withdraw = useWithdrawCollateral();

  const { requests: activeRequests, refresh: refreshLoans } =
    useGetActiveRequest();
  const {
    collateral: registeredCollateral,
    loanable,
    holdings,
    loading: assetsLoading,
    error: assetsError,
    refresh: refreshAssets,
  } = useLendingAssets();
  const {
    data2,
    collateralVal,
    refresh: refreshHealth,
  } = useGetValueAndHealth();
  const fees = useLendingFees();

  /**
   * Refuse an action whose wallet chain is not the lending chain.
   *
   * Returns true when the caller should stop. Toasts rather than throwing
   * because every call site is a button handler that already has a `finally`
   * resetting its busy flag — an exception here would surface as "Couldn't
   * update collateral" and hide the one thing the user can act on.
   */
  const wrongChain = useCallback((): boolean => {
    const message = lendingChainMismatch(activeChain?.id);
    if (message) {
      toast.warning(message);
      return true;
    }
    return false;
  }, [activeChain?.id]);

  const loans: ActiveLoan[] = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return (activeRequests ?? [])
      .filter((r) => Number(r.totalRepayment) > 0)
      .map((r) => {
        // Must be the same chain useGetActiveRequest used to format
        // `r.totalRepayment` — this parseUnits is the inverse of that
        // formatUnits, and a mismatch would rescale the repay amount.
        const decimals = getTokenDecimals(READ_ONLY_CHAIN_ID, r.tokenAddress);
        let raw = "0";
        try {
          raw = ethers
            .parseUnits(String(r.totalRepayment), decimals)
            .toString();
        } catch {
          raw = "0";
        }
        return {
          requestId: r.requestId,
          amount: String(r.amount),
          totalRepayment: String(r.totalRepayment),
          totalRepaymentRaw: raw,
          interestBps: Number(r.interest),
          returnDate: Number(r.returnDate),
          lender: r.lender,
          tokenAddress: r.tokenAddress,
          /* Resolved on the same chain the decimals above came from, and for the
             same reason: this address arrived from the diamond, so only
             (chain, address) can name it. It read `tokenImageMap[addr]?.label`
             until the address cutover, and that table held Abstract literals —
             so after the cutover every row on every deployed chain rendered its
             currency as "—". */
          symbol: declaredSymbol(READ_ONLY_CHAIN_ID, r.tokenAddress) ?? "—",
          status: r.status,
          overdue: Number(r.returnDate) > 0 && Number(r.returnDate) < now,
        };
      });
  }, [activeRequests]);

  /*
   * Deposited collateral now comes from useLendingAssets, which reads
   * `gets_addressToCollateralDeposited` once per asset the diamond actually
   * registers as collateral.
   *
   * It used to be four fixed rows paired positionally with the AVA/AVA2/AVA4/AVA5
   * atoms in useGetValueAndHealth, and that set was wrong in both directions on
   * every deployed chain: it carried kfUSD, which is registered as collateral
   * nowhere, and it had no row for the wrapped native (WETH9 / WBNB / WUSDC),
   * which is registered on all five. A user who deposited WETH saw nothing and
   * had no way to withdraw it from this surface.
   *
   * useGetValueAndHealth still owns the USD total and the health factor — those
   * are single diamond calls that price the whole position, not per-asset reads.
   */
  const refreshPosition = useCallback(() => {
    refreshHealth();
    refreshAssets();
  }, [refreshHealth, refreshAssets]);

  const postOffer = useCallback(
    async (p: PostOfferParams) => {
      if (wrongChain()) return;
      await createListing(
        p.amount,
        p.minAmount,
        p.maxAmount,
        p.returnDate,
        p.interest,
        p.asset,
        p.onSuccess,
      );
    },
    [createListing, wrongChain],
  );

  const postRequest = useCallback(
    async (p: PostRequestParams) => {
      if (wrongChain()) return;
      await createRequest(
        p.amount,
        p.interest,
        p.returnDate,
        p.asset,
        p.onSuccess,
      );
    },
    [createRequest, wrongChain],
  );

  const takeLoan = useCallback(
    async (p: TakeLoanParams) => {
      if (wrongChain()) return;
      await acceptListing(p.listingId, p.amount, p.asset, p.onSuccess);
    },
    [acceptListing, wrongChain],
  );

  const repay = useCallback(
    async (loan: ActiveLoan) => {
      if (wrongChain()) return;
      await repayLoan(
        loan.requestId,
        loan.tokenAddress,
        loan.totalRepaymentRaw,
      );
    },
    [repayLoan, wrongChain],
  );

  const depositCollateral = useCallback(
    async (amount: string, asset: LendingAsset) => {
      if (wrongChain()) return;
      if (asset.isNative) await depositNative(amount, () => {});
      else await depositErc20(amount, asset, () => {});
    },
    [depositNative, depositErc20, wrongChain],
  );

  const withdrawCollateral = useCallback(
    async (amount: string, asset: LendingAsset) => {
      if (wrongChain()) return;
      await withdraw(asset, amount, () => {});
    },
    [withdraw, wrongChain],
  );

  return {
    loans,
    collateral: holdings,
    assets: {
      collateral: registeredCollateral,
      loanable,
      loading: assetsLoading,
      error: assetsError,
    },
    collateralValueUsd: Number(collateralVal) || 0,
    /* Owns its own MOCK_DATA branch, so it is outside the fixture spread below —
       the demo values are the real on-chain ones anyway. */
    fees,
    // No open loans means nothing can be liquidated, so there is no health
    // factor worth showing — the card renders "—" rather than the contract's
    // no-debt sentinel. Mirrors usePortfolio's Infinity guard.
    //
    // `Number.isFinite` is what actually enforces that second half. `data2 > 0`
    // does not: the sentinel arrives as Infinity (useGetValueAndHealth catches
    // `type(uint256).max` on the bigint) and Infinity is greater than zero, so it
    // passed straight through this test. It is reachable with `loans.length > 0`
    // too — a wallet whose requests are all OPEN has loans in this list and zero
    // *serviced* debt, which is precisely the branch the facet answers with the
    // sentinel.
    healthFactor:
      loans.length > 0 && Number(data2) > 0 && Number.isFinite(Number(data2))
        ? Number(data2) * HEALTH_SCALE
        : null,
    postOffer,
    postRequest,
    takeLoan,
    repay,
    depositCollateral,
    withdrawCollateral,
    refreshPosition,
    refreshLoans,
    /*
     * Demo mode: the four read fields only. `repay` still builds a real
     * transaction from the fixture's `totalRepaymentRaw`, which is the point —
     * pressing Repay should fail the way it will fail on an undeployed chain,
     * not silently succeed.
     *
     * The health factor is in the warning band and matches src/lib/mock's
     * portfolio fixture, so /borrow and /portfolio agree; the USD total is the
     * same collateral priced the same way. Delete with src/lib/mock.
     */
    ...(MOCK_DATA
      ? {
          loans: MOCK_LOANS,
          collateral: MOCK_COLLATERAL,
          collateralValueUsd: MOCK_PORTFOLIO.collateralUsd ?? 0,
          healthFactor: MOCK_PORTFOLIO.health,
        }
      : {}),
  };
};

export default useBorrowV2;
