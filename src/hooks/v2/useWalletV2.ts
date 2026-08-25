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
  /**
   * Undefined when no wallet is connected, because there is no chain to name.
   *
   * This used to fall back to "Abstract", from when Abstract was the home
   * chain. It read as a claim: the nav rendered "Abstract" beside a Connect
   * button, so a disconnected user was told they were on the one chain we had
   * just deprioritised to balance-reading only. Each call site now says what it
   * wants to show instead, because a nav button that opens a picker and a
   * portfolio subtitle want different words.
   */
  chainName?: string;
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
    /* "Unknown" only when a wallet really is on a chain we do not carry — that
       is a fact worth showing, and distinct from having no chain at all. */
    chainName: chain?.id
      ? (CHAINS_BY_ID[chain.id]?.shortName ?? "Unknown")
      : undefined,
    isConnected: Boolean(address),
  };
};
