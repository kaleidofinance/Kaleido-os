"use client";

import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { CHAINS_BY_ID } from "@/constants/chains";

/**
 * Bridge hook — the single place v2 reads wallet state.
 *
 * Wrapping the thirdweb hooks here means v2 components depend on a small,
 * stable shape rather than on thirdweb directly, so the wallet stack can be
 * swapped (the app currently carries six) without touching the UI.
 */
export interface WalletV2 {
  address?: string;
  shortAddress?: string;
  chainId?: number;
  chainName: string;
  isConnected: boolean;
}

const short = (addr?: string) =>
  addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : undefined;

export const useWalletV2 = (): WalletV2 => {
  const account = useActiveAccount();
  const chain = useActiveWalletChain();
  const address = account?.address;

  return {
    address,
    shortAddress: short(address),
    chainId: chain?.id,
    chainName: chain?.id ? (CHAINS_BY_ID[chain.id]?.shortName ?? "Unknown") : "Abstract",
    isConnected: Boolean(address),
  };
};
