"use client";

import { useWalletAddress, useWalletChainId } from "@/lib/wallet";
import { CHAINS_BY_ID } from "@/constants/chains";

/**
 * Bridge hook — the single place v2 reads wallet state.
 *
 * Reads through the provider-agnostic `@/lib/wallet` facade rather than a wallet
 * SDK directly, so v2 components depend on a small, stable shape and the wallet
 * provider can be swapped (see `src/lib/wallet/adapter.ts`) without touching the
 * UI.
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
  const address = useWalletAddress();
  const chainId = useWalletChainId();

  return {
    address,
    shortAddress: short(address),
    chainId,
    /* "Unknown" only when a wallet really is on a chain we do not carry — that
       is a fact worth showing, and distinct from having no chain at all. */
    chainName: chainId
      ? (CHAINS_BY_ID[chainId]?.shortName ?? "Unknown")
      : undefined,
    isConnected: Boolean(address),
  };
};
