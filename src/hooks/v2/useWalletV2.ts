"use client";

import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";

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

const CHAIN_NAMES: Record<number, string> = {
  11124: "Abstract",
  2741: "Abstract",
  8453: "Base",
  42161: "Arbitrum",
  137: "Polygon",
  56: "BNB Chain",
  1: "Ethereum",
};

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
    chainName: chain?.id ? (CHAIN_NAMES[chain.id] ?? "Unknown") : "Abstract",
    isConnected: Boolean(address),
  };
};
