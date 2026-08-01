"use client";

import useStakeAction from "@/hooks/useStake";
import useWithdrawStake from "@/hooks/useWithdrawStake";
import useRequestWithdrawal from "@/hooks/useRequestWithdrawal";
import useCancelWithdrawalRequest from "@/hooks/useCancelWithdrawalRequest";
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth";

/**
 * Bridge hook for the v2 Stake page.
 *
 * Wraps the three legacy stake hooks into one clean shape, the same way
 * useWalletV2 wraps thirdweb. The v2 page never sees `data`/`AVA`/`txStatus` —
 * it sees stakedBalance, totalStaked, stake(), unstake().
 *
 * No APY: none of the underlying hooks expose one (usePortfolio leaves stKLD's
 * apy null for the same reason). The yield is the exchange rate — stKLD
 * appreciates against KLD as rewards accrue — so we surface that instead of
 * inventing a percentage.
 *
 * Withdrawing is a three-step lifecycle in the vault, not a single call:
 * requestWithdrawal → wait out the cooldown → withdraw. Exposing only
 * withdraw (as this hook first did) leaves users with a button that reverts,
 * so the request/cancel steps and the countdown are surfaced too.
 */
export interface StakeV2 {
  /** stKLD the user holds. */
  stakedBalance: string;
  /** Total KLD staked across the vault. */
  totalStaked: number | null;
  stakers: number | null;
  /** KLD per stKLD. > 1 and rising as rewards accrue. Null until loaded. */
  exchangeRate: number | null;
  stake: (amount: string) => Promise<void>;
  unstake: (amount: string) => Promise<void>;
  staking: boolean;
  unstaking: boolean;
  /** Seconds until a requested withdrawal unlocks. 0 once claimable. */
  cooldownLeft: number;
  /** True while the cooldown is still running. */
  cooldownActive: boolean;
  requestWithdrawal: (amount: string) => Promise<void>;
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
  const { userstKldBalance, totalPooledKLD, totalShares, totalStakers, timeLeft } =
    useGetValueAndHealth();

  const pooled = Number(totalPooledKLD);
  const shares = Number(totalShares);
  const exchangeRate =
    Number.isFinite(pooled) && Number.isFinite(shares) && shares > 0
      ? pooled / shares
      : null;

  const cooldownLeft = Number(timeLeft) > 0 ? Number(timeLeft) : 0;

  return {
    stakedBalance: String(userstKldBalance ?? "0"),
    totalStaked: Number.isFinite(pooled) ? pooled : null,
    stakers: Number.isFinite(Number(totalStakers)) ? Number(totalStakers) : null,
    exchangeRate,
    stake: Stake,
    unstake: WithdrawStake,
    staking: Boolean(txStakeStatus),
    unstaking: Boolean(txStatus),
    cooldownLeft,
    cooldownActive: cooldownLeft > 0,
    requestWithdrawal,
    cancelWithdrawal: cancelWithdrawalRequest,
    requesting: Boolean(withdrawalRequestStatus),
    cancelling: Boolean(cancelWithdrawalRequestStatus),
  };
};

export default useStakeV2;
