"use client";

import { useCallback } from "react";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { toEthersSigner } from "@/lib/wallet/ethersSigner";
import type { ResolverContext } from "@/lib/v2/intents";

/**
 * Builds a ResolverContext for the intent bus — the single place v2 turns the
 * connected wallet into an ethers signer, using the app-standard thirdweb
 * ethers6 adapter (same call the legacy hooks make internally).
 *
 * Returns a getter rather than a value so callers build the signer at execute
 * time, and so a component can check "can I execute?" (getter returns null when
 * disconnected) without holding a signer it isn't using.
 */
export function useResolverContext(): () => ResolverContext | null {
  const account = useActiveAccount();
  const chain = useActiveWalletChain();

  return useCallback(() => {
    if (!account || !chain) return null;
    const signer = toEthersSigner(account, chain);
    return { signer, address: account.address, chainId: chain.id };
  }, [account, chain]);
}
