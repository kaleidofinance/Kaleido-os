"use client";

import { useCallback, useMemo } from "react";
import { ethers } from "ethers";
import useCreateLoanListing from "@/hooks/useCreateLoanListing";
import useCreateLendingRequest from "@/hooks/useCreateLendingRequest";
import useAcceptListedAds from "@/hooks/useAcceptListedAds";
import useRepayLoan from "@/hooks/useRepayLoan";
import useDepositCollateral from "@/hooks/useDepositCollateral";
import useDepositNativeCollateral from "@/hooks/useDepositNativeColateral";
import useWithdrawCollateral from "@/hooks/useWithdrawCollateral";
import useGetActiveRequest from "@/hooks/useGetActiveRequest";
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";
import { tokenImageMap } from "@/constants/utils/tokenImageMap";
import {
  ADDRESS_1,
  USDC_ADDRESS,
  USDR,
  kfUSD_ADDRESS,
  USDT_ADDRESS,
} from "@/constants/utils/addresses";

/**
 * Bridge hook for the v2 Borrow surface.
 *
 * Same job as useStakeV2: wrap the legacy loan hooks into one typed shape so
 * v2 pages never touch `data`/`AVA`/raw wei. Every action here passes an
 * onSuccess callback, which is what keeps v2 inside its own shell — the legacy
 * hooks otherwise router.push() to "/" or "/successful" mid-flow.
 */

export const BORROW_CURRENCIES = [
  { symbol: "ETH", address: ADDRESS_1, decimals: 18 },
  { symbol: "USDC", address: USDC_ADDRESS, decimals: 6 },
  { symbol: "USDT", address: USDT_ADDRESS, decimals: 6 },
  { symbol: "USDR", address: USDR, decimals: 18 },
  { symbol: "kfUSD", address: kfUSD_ADDRESS, decimals: 18 },
] as const;

export type BorrowCurrency = (typeof BORROW_CURRENCIES)[number]["symbol"];

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

export interface CollateralHolding {
  symbol: string;
  address: string;
  amount: number;
}

export interface BorrowV2 {
  loans: ActiveLoan[];
  collateral: CollateralHolding[];
  collateralValueUsd: number;
  /** Contract health factor. Null when nothing is borrowed. */
  healthFactor: number | null;
  postOffer: (p: PostOfferParams) => Promise<void>;
  postRequest: (p: PostRequestParams) => Promise<void>;
  takeLoan: (p: TakeLoanParams) => Promise<void>;
  repay: (loan: ActiveLoan) => Promise<void>;
  depositCollateral: (amount: string, tokenAddress: string) => Promise<void>;
  withdrawCollateral: (amount: string, tokenAddress: string) => Promise<void>;
}

export interface PostOfferParams {
  amount: string;
  minAmount: number;
  maxAmount: number;
  /** Unix seconds. */
  returnDate: number;
  interest: number;
  currency: BorrowCurrency;
  onSuccess?: () => void;
}

export interface PostRequestParams {
  amount: string;
  interest: number;
  returnDate: number;
  currency: BorrowCurrency;
  onSuccess?: () => void;
}

export interface TakeLoanParams {
  listingId: number;
  amount: string;
  currency: string;
  onSuccess?: () => void;
}

export const useBorrowV2 = (): BorrowV2 => {
  const createListing = useCreateLoanListing();
  const createRequest = useCreateLendingRequest();
  const acceptListing = useAcceptListedAds();
  const repayLoan = useRepayLoan();
  const depositErc20 = useDepositCollateral();
  const depositNative = useDepositNativeCollateral();
  const withdraw = useWithdrawCollateral();

  const activeRequests = useGetActiveRequest();
  const { data2, collateralVal, AVA, AVA2, AVA3, AVA4, AVA5 } =
    useGetValueAndHealth();

  const loans: ActiveLoan[] = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return (activeRequests ?? [])
      .filter((r) => Number(r.totalRepayment) > 0)
      .map((r) => {
        const decimals = getTokenDecimals(r.tokenAddress);
        let raw = "0";
        try {
          raw = ethers.parseUnits(String(r.totalRepayment), decimals).toString();
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
          symbol: tokenImageMap[r.tokenAddress]?.label ?? "—",
          status: r.status,
          overdue: Number(r.returnDate) > 0 && Number(r.returnDate) < now,
        };
      });
  }, [activeRequests]);

  // useGetValueAndHealth exposes each collateral balance as its own atom
  // rather than a list, so the mapping to a list lives here.
  const collateral: CollateralHolding[] = useMemo(
    () =>
      [
        { symbol: "ETH", address: ADDRESS_1, amount: Number(AVA) || 0 },
        { symbol: "USDC", address: USDC_ADDRESS, amount: Number(AVA2) || 0 },
        { symbol: "USDR", address: USDR, amount: Number(AVA3) || 0 },
        { symbol: "kfUSD", address: kfUSD_ADDRESS, amount: Number(AVA4) || 0 },
        { symbol: "USDT", address: USDT_ADDRESS, amount: Number(AVA5) || 0 },
      ].filter((c) => c.amount > 0),
    [AVA, AVA2, AVA3, AVA4, AVA5],
  );

  const postOffer = useCallback(
    async (p: PostOfferParams) => {
      await createListing(
        p.amount,
        p.minAmount,
        p.maxAmount,
        p.returnDate,
        p.interest,
        p.currency,
        p.onSuccess,
      );
    },
    [createListing],
  );

  const postRequest = useCallback(
    async (p: PostRequestParams) => {
      await createRequest(
        p.amount,
        p.interest,
        p.returnDate,
        p.currency,
        p.onSuccess,
      );
    },
    [createRequest],
  );

  const takeLoan = useCallback(
    async (p: TakeLoanParams) => {
      await acceptListing(p.listingId, p.amount, p.currency, p.onSuccess);
    },
    [acceptListing],
  );

  const repay = useCallback(
    async (loan: ActiveLoan) => {
      await repayLoan(loan.requestId, loan.tokenAddress, loan.totalRepaymentRaw);
    },
    [repayLoan],
  );

  const depositCollateral = useCallback(
    async (amount: string, tokenAddress: string) => {
      if (tokenAddress === ADDRESS_1) await depositNative(amount, () => {});
      else await depositErc20(amount, tokenAddress, () => {});
    },
    [depositNative, depositErc20],
  );

  const withdrawCollateral = useCallback(
    async (amount: string, tokenAddress: string) => {
      await withdraw(tokenAddress, amount, () => {});
    },
    [withdraw],
  );

  return {
    loans,
    collateral,
    collateralValueUsd: Number(collateralVal) || 0,
    healthFactor: Number(data2) > 0 ? Number(data2) : null,
    postOffer,
    postRequest,
    takeLoan,
    repay,
    depositCollateral,
    withdrawCollateral,
  };
};

export default useBorrowV2;
