"use client";

import { useCallback } from "react";
import useStakeAction from "@/hooks/useStake";
import useWithdrawStake from "@/hooks/useWithdrawStake";
import useRequestWithdrawal from "@/hooks/useRequestWithdrawal";
import useCancelWithdrawalRequest from "@/hooks/useCancelWithdrawalRequest";
import { useStakingData } from "@/hooks/v2/useStakingData";
import { MOCK_DATA, MOCK_STAKE } from "@/lib/mock";

/**
 * Bridge hook for the v2 Stake page.
 *
 * Wraps the write hooks and the read layer into one clean shape, the same way
 * useWalletV2 wraps thirdweb. The v2 page never sees `data`/`AVA`/`txStatus` —
 * it sees stakedBalance, totalStaked, stake(), unstake().
 *
 * The reads come from `useStakingData` — multicall-batched and read on the
 * WALLET'S chain. They used to come from `useGetValueAndHealth`, which pinned
 * every staking read to `READ_ONLY_CHAIN_ID` while the write below goes to the
 * wallet's chain: a stake on any chain but Sepolia showed "Your stake: 0" and
 * Sepolia's totals. Staking is deployed on all five chains independently, so its
 * reads have to follow the wallet the way `useStake` already does.
 *
 * No APY: none of the underlying reads expose one (usePortfolio leaves stKLD's
 * apy null for the same reason). The yield shows up as the share price rising —
 * see yieldIndex — so we surface that instead of inventing a percentage.
 *
 * Withdrawing is a three-step lifecycle in the vault, not a single call:
 * requestWithdrawal → wait out the cooldown → withdraw. Exposing only
 * withdraw (as this hook first did) leaves users with a button that reverts,
 * so the request/cancel steps and the countdown are surfaced too.
 */
export interface StakeV2 {
  /** stKLD the user holds. Already KLD-denominated, because stKLD rebases. */
  stakedBalance: string;
  /** Total KLD staked across the vault. */
  totalStaked: number | null;
  stakers: number | null;
  /**
   * Cumulative growth of the share price — pooled KLD over total shares. Starts
   * at 1.0 and rises each time yield is harvested. Null until loaded.
   *
   * Deliberately not called an exchange rate. stKLD is a rebasing token, so
   * balanceOf already returns the holder's pooled-KLD claim: 1 stKLD is always
   * worth 1 KLD to the holder and stake/unstake is 1:1. Multiplying a displayed
   * balance by this figure double-counts the rebase.
   */
  yieldIndex: number | null;
  /** True while the batched read is in flight and no cached data exists yet. */
  loading: boolean;
  stake: (amount: string) => Promise<void>;
  unstake: (amount: string) => Promise<void>;
  staking: boolean;
  unstaking: boolean;
  /** True while a requested withdrawal is open — requested, not yet withdrawn. */
  hasRequest: boolean;
  /** Seconds until a requested withdrawal unlocks. 0 once claimable. */
  cooldownLeft: number;
  /** True while the cooldown is still running. */
  cooldownActive: boolean;
  /** Takes no amount: the vault stores a per-account cooldown timestamp. */
  requestWithdrawal: () => Promise<void>;
  cancelWithdrawal: () => Promise<void>;
  requesting: boolean;
  cancelling: boolean;
}

export const useStakeV2 = (): StakeV2 => {
  const { Stake, txStakeStatus } = useStakeAction();
  const { WithdrawStake, txStatus } = useWithdrawStake();
  const { requestWithdrawal, withdrawalRequestStatus } = useRequestWithdrawal();
  const { cancelWithdrawalRequest, cancelWithdrawalRequestStatus } =
    useCancelWithdrawalRequest();
  const {
    stakedBalance,
    totalStaked,
    stakers,
    yieldIndex,
    hasRequest,
    cooldownLeft,
    loading,
    refetch,
  } = useStakingData();

  /*
   * Every staking write is followed by a refetch.
   *
   * None of the four write hooks refetch on their own, so without this the page
   * shows pre-transaction state until react-query's staleTime lapses or a manual
   * reload. That is worst on the request/cancel pair, which the Unstake button is
   * gated on: a successful request that did not re-read leaves the CTA reading
   * "Request withdrawal first" with the Request button still enabled.
   *
   * Safe to refetch immediately because the write hooks await the receipt
   * (transaction.wait()) before resolving, so the new state is mined by the time
   * these do. A refetch after a failed tx just re-reads unchanged state.
   */
  const withRefresh = useCallback(
    <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
      async (...args: A) => {
        await fn(...args);
        refetch();
      },
    [refetch],
  );

  return {
    stakedBalance: String(stakedBalance ?? "0"),
    totalStaked,
    stakers,
    yieldIndex,
    loading,
    stake: withRefresh(Stake),
    unstake: withRefresh(WithdrawStake),
    staking: Boolean(txStakeStatus),
    unstaking: Boolean(txStatus),
    hasRequest,
    cooldownLeft,
    cooldownActive: cooldownLeft > 0,
    requestWithdrawal: withRefresh(requestWithdrawal),
    cancelWithdrawal: withRefresh(cancelWithdrawalRequest),
    requesting: Boolean(withdrawalRequestStatus),
    cancelling: Boolean(cancelWithdrawalRequestStatus),
    /*
     * Demo mode: overrides the read fields above and nothing else, so every
     * button on the page still calls the real contract. Last in the object
     * because that is what makes it override. Delete with src/lib/mock.
     */
    ...(MOCK_DATA ? MOCK_STAKE : {}),
  };
};

export default useStakeV2;
