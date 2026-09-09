"use client";

import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import KLDVaultAbi from "@/abi/KLDVaultAbi.json";
import StKLDAbi from "@/abi/StKLDAbi.json";
import { stakingContracts } from "@/constants/registry";
import { READ_ONLY_CHAIN_ID } from "@/config/provider";
import { readContracts, type Call } from "@/lib/chain/multicall";

/**
 * Every staking figure the /stake page needs, read from the chain the wallet is
 * on, in one batched call.
 *
 * This is the first hook moved onto the multicall + react-query layer, and it
 * exists because the reads it replaces were the staking bug: `useGetValueAndHealth`
 * pinned every staking read to `READ_ONLY_CHAIN_ID` (Sepolia) while a stake is
 * written on the wallet's chain, so anyone who staked on BSC, Base, Arc or
 * Robinhood saw "Your stake: 0" and Sepolia's totals — a stake that had plainly
 * left their wallet, nowhere on the page. Staking is deployed independently on
 * all five chains; its reads have to follow the wallet the way the write does.
 *
 * Walletless, it falls back to the read chain so a public visitor still sees a
 * populated vault — the aggregates below need no address.
 *
 * Six views, one round trip. `getTotalPooledKld`, `getTotalShares` and
 * `getTotalStakers` describe the vault; `balanceOf`, `getWithdrawalTimeLeft` and
 * `hasWithdrawalRequest` describe the caller. Reading them together means every
 * number on the page is from the same block, and a throttle failure is one
 * missing figure the UI shows as "—" rather than a fabricated zero.
 */

/* These ABI JSONs are raw fragment arrays — config/contracts.ts hands them
   straight to `new ethers.Contract(addr, KLDVaultAbi, …)`, which is the same
   shape `Interface` takes. */
const VAULT = new ethers.Interface(
  KLDVaultAbi as unknown as ethers.InterfaceAbi,
);
const STKLD = new ethers.Interface(StKLDAbi as unknown as ethers.InterfaceAbi);

export interface StakingData {
  /** The caller's stake, KLD-denominated (stKLD rebases, so balanceOf IS the KLD claim). Null when unread. */
  stakedBalance: string | null;
  /** Total KLD pooled in the vault. Null when unread. */
  totalStaked: number | null;
  /** Number of stakers. Null when unread. */
  stakers: number | null;
  /** Pooled KLD ÷ total shares — the share price, rising as yield is harvested. Null until both read. */
  yieldIndex: number | null;
  /** True while a withdrawal request is open. */
  hasRequest: boolean;
  /** Seconds until a requested withdrawal unlocks; 0 once claimable or none. */
  cooldownLeft: number;
  loading: boolean;
  /** Re-read now — call after a stake/unstake/request write. */
  refetch: () => void;
}

/** A uint256 return read as a human number at 18 decimals, or null when unread. */
const num18 = (r: { success: boolean; value: unknown }): number | null =>
  r.success && r.value !== null
    ? Number(ethers.formatUnits(r.value as bigint, 18))
    : null;

export function useStakingData(): StakingData {
  const account = useActiveAccount();
  const address = account?.address;
  const walletChainId = useActiveWalletChain()?.id;
  /* The wallet's chain when connected — that is the whole point — and the read
     chain only as a walletless fallback so the public aggregates still show. */
  const chainId = walletChainId ?? READ_ONLY_CHAIN_ID;

  const staking = stakingContracts(chainId);

  const query = useQuery({
    queryKey: ["staking", chainId, address ?? null],
    /* No vault on this chain means nothing to read — react-query keeps the last
       data and the hook reports its null defaults. */
    enabled: staking.supported,
    queryFn: async () => {
      const vault = staking.kldVault!;
      const stKld = staking.stKLD!;
      const kld = staking.kld!;

      /* Aggregates first (fixed indices 0-2), then the three account views only
         when a wallet is connected. Indices are read back positionally below. */
      const calls: Call[] = [
        { target: vault, iface: VAULT, method: "getTotalPooledKld", args: [kld] },
        { target: stKld, iface: STKLD, method: "getTotalShares" },
        { target: vault, iface: VAULT, method: "getTotalStakers" },
      ];
      if (address) {
        calls.push(
          { target: stKld, iface: STKLD, method: "balanceOf", args: [address] },
          { target: vault, iface: VAULT, method: "getWithdrawalTimeLeft", args: [address] },
          { target: vault, iface: VAULT, method: "hasWithdrawalRequest", args: [address] },
        );
      }

      const r = await readContracts(chainId, calls);

      const pooled = num18(r[0]);
      const shares = num18(r[1]);
      const stakers =
        r[2].success && r[2].value !== null ? Number(r[2].value) : null;

      const userBal = address ? r[3] : null;
      const timeLeftRaw = address ? r[4] : null;
      const requested = address ? r[5] : null;

      return {
        totalStaked: pooled,
        totalShares: shares,
        stakers,
        stakedBalance:
          userBal && userBal.success && userBal.value !== null
            ? ethers.formatUnits(userBal.value as bigint, 18)
            : null,
        cooldownLeft:
          timeLeftRaw && timeLeftRaw.success && timeLeftRaw.value !== null
            ? Math.max(0, Number(timeLeftRaw.value))
            : 0,
        hasRequest:
          requested && requested.success ? Boolean(requested.value) : false,
      };
    },
  });

  const d = query.data;
  const pooled = d?.totalStaked ?? null;
  const shares = d?.totalShares ?? null;

  return {
    stakedBalance: d?.stakedBalance ?? null,
    totalStaked: pooled,
    stakers: d?.stakers ?? null,
    yieldIndex:
      pooled !== null && shares !== null && shares > 0 ? pooled / shares : null,
    hasRequest: d?.hasRequest ?? false,
    cooldownLeft: d?.cooldownLeft ?? 0,
    loading: query.isLoading,
    refetch: () => {
      query.refetch();
    },
  };
}

export default useStakingData;
