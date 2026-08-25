"use client";

import { useCallback } from "react";
import useStakeAction from "@/hooks/useStake";
import useWithdrawStake from "@/hooks/useWithdrawStake";
import useRequestWithdrawal from "@/hooks/useRequestWithdrawal";
import useCancelWithdrawalRequest from "@/hooks/useCancelWithdrawalRequest";
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth";
import { MOCK_DATA, MOCK_STAKE } from "@/lib/mock";

/**
 * Bridge hook for the v2 Stake page.
 *
 * Wraps the three legacy stake hooks into one clean shape, the same way
 * useWalletV2 wraps thirdweb. The v2 page never sees `data`/`AVA`/`txStatus` —
 * it sees stakedBalance, totalStaked, stake(), unstake().
 *
 * No APY: none of the underlying hooks expose one (usePortfolio leaves stKLD's
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

/**
 * A staking atom's value as a number, or null when it has not been read.
 *
 * `Number("")` is 0 — and `totalPooledKLDAtom` starts as "" — so the obvious
 * `Number.isFinite(Number(x))` guard published a confident "0 KLD staked" to
 * every visitor before the vault read landed, and again whenever it failed.
 * useGetValueAndHealth deliberately leaves those atoms empty rather than zeroing
 * them on failure; throwing the distinction away here would waste that.
 */
const measured = (v: string | number | undefined | null): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const useStakeV2 = (): StakeV2 => {
  const { Stake, txStakeStatus } = useStakeAction();
  const { WithdrawStake, txStatus } = useWithdrawStake();
  const { requestWithdrawal, withdrawalRequestStatus } = useRequestWithdrawal();
  const { cancelWithdrawalRequest, cancelWithdrawalRequestStatus } =
    useCancelWithdrawalRequest();
  const {
    refresh,
    userstKldBalance,
    totalPooledKLD,
    totalShares,
    totalStakers,
    timeLeft,
    hasWithdrawalRequest,
  } = useGetValueAndHealth();

  const pooled = measured(totalPooledKLD);
  const shares = measured(totalShares);
  const yieldIndex =
    pooled !== null && shares !== null && shares > 0 ? pooled / shares : null;

  const cooldownLeft = Number(timeLeft) > 0 ? Number(timeLeft) : 0;

  /*
   * Every staking write is followed by a refetch.
   *
   * None of the four underlying hooks refetch on their own, and the read effect
   * only re-runs when the address changes or the nonce is bumped — so without
   * this the page shows pre-transaction state until a manual reload. That is
   * worst on the request/cancel pair, which the Unstake button is gated on: a
   * successful request left hasRequest false, so the CTA went on reading
   * "Request withdrawal first" and the Request button stayed enabled.
   *
   * Safe to refresh immediately because the hooks await StakeTransactionResult,
   * which awaits transaction.wait() — the receipt is mined by the time these
   * resolve. Errors are swallowed inside the hooks (they toast and return), so
   * a refresh after a failed tx just re-reads unchanged state.
   */
  const withRefresh = useCallback(
    <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
      async (...args: A) => {
        await fn(...args);
        refresh();
      },
    [refresh],
  );

  return {
    stakedBalance: String(userstKldBalance ?? "0"),
    totalStaked: pooled,
    stakers: measured(totalStakers),
    yieldIndex,
    stake: withRefresh(Stake),
    unstake: withRefresh(WithdrawStake),
    staking: Boolean(txStakeStatus),
    unstaking: Boolean(txStatus),
    hasRequest: Boolean(hasWithdrawalRequest),
    cooldownLeft,
    cooldownActive: cooldownLeft > 0,
    requestWithdrawal: withRefresh(requestWithdrawal),
    cancelWithdrawal: withRefresh(cancelWithdrawalRequest),
    requesting: Boolean(withdrawalRequestStatus),
    cancelling: Boolean(cancelWithdrawalRequestStatus),
    /*
     * Demo mode: overrides the seven read fields above and nothing else, so
     * every button on the page still calls the real contract. Last in the object
     * because that is what makes it override, and because it makes removal a
     * one-line deletion. Delete with src/lib/mock.
     *
     * Safe to apply synchronously, unlike the async hooks: these are constants,
     * so the server pass and the first client render agree. Nothing here is
     * derived from the clock — that is why `cooldownLeft` is a fixed number of
     * seconds rather than a deadline.
     */
    ...(MOCK_DATA ? MOCK_STAKE : {}),
  };
};

export default useStakeV2;
