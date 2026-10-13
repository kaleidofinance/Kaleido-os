"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  useConnectWallet as useConnectWalletProvider,
  useSwitchWalletChain,
  useWalletAddress,
  useWalletChainId,
} from "@/lib/wallet";
import { getChainMeta } from "@/constants/chains";
import { isSupportedChain } from "@/config/chain";

/**
 * The wallet-chain gate every action surface shares.
 *
 * Swap, the lending forms and limit each grew their own copy of the same three
 * moves — is the wallet on the right chain, switch it if not, then act — and the
 * copies had already drifted (one toasts on a failed switch, one stays silent).
 * This is the single implementation, and it reads and switches through the
 * provider-agnostic `@/lib/wallet` facade, so the provider underneath (thirdweb
 * today, maybe not tomorrow) is named in the adapter, never at a CTA.
 *
 * `targetChainId` is the chain the action runs on. Given, `wrong` is a strict
 * mismatch against it — the multichain swap and the multichain lending forms both
 * pass the chain the form is acting on. Omitted, the gate falls back to "on any
 * chain we support" (`isSupportedChain`) and switches toward `fallbackChainId` —
 * the shape a single-chain surface with a home chain wants.
 *
 * DISCONNECTED IS NOT A MISMATCH. With no wallet there is nothing to switch, so
 * `wrong` is false and a caller shows Connect rather than Switch; switchChain on a
 * wallet that was never connected would throw, and the catch would advise
 * switching one that does not exist.
 */
export interface ChainGateAction {
  /** Connected, but on the wrong chain for this action. */
  wrong: boolean;
  /** A switch is in flight — disable the CTA, don't hide the reason. */
  switching: boolean;
  /** Switch to the target chain; resolves false if it failed or was declined. */
  goToChain: () => Promise<boolean>;
  /**
   * Switch if wrong, then run — the one-click fold (swap's `startSwap`). A
   * declined switch stops before the action. Safe ONLY where nothing
   * chain-dependent runs before the action; a surface whose gate must clear on
   * the target chain first (the lending collateral check, #95) calls `goToChain`
   * as a discrete step instead.
   */
  run: (action: () => void | Promise<void>) => Promise<void>;
  /** Human label for the target chain, for the CTA ("Post on Base"). */
  target: string;
}

export function useChainGateAction(
  targetChainId?: number,
  fallbackChainId?: number,
): ChainGateAction {
  const address = useWalletAddress();
  const chainId = useWalletChainId();
  const switchChain = useSwitchWalletChain();
  const [switching, setSwitching] = useState(false);

  const goTo = targetChainId ?? fallbackChainId;
  const meta = goTo != null ? getChainMeta(goTo) : undefined;
  const target =
    meta?.shortName ??
    meta?.name ??
    (goTo != null ? `chain ${goTo}` : "the right network");

  const wrong =
    !!address &&
    chainId != null &&
    (targetChainId !== undefined
      ? chainId !== targetChainId
      : !isSupportedChain(chainId));

  const goToChain = async (): Promise<boolean> => {
    if (goTo == null || !meta) {
      toast.error(
        goTo == null
          ? "No target network for this action."
          : `Chain ${goTo} is not in the registry.`,
      );
      return false;
    }
    setSwitching(true);
    try {
      await switchChain(goTo);
      return true;
    } catch {
      toast.error(
        `Couldn't switch to ${meta.name} — switch manually in your wallet, then try again.`,
      );
      return false;
    } finally {
      setSwitching(false);
    }
  };

  const run = async (action: () => void | Promise<void>) => {
    if (wrong && !(await goToChain())) return;
    await action();
  };

  return { wrong, switching, goToChain, run, target };
}

/**
 * Open the connect modal — the one opener the CTAs share.
 *
 * Now a thin re-export of the provider-agnostic opener in `@/lib/wallet`, kept
 * at this path so the CTAs that import it here do not change. The wallet list
 * and client are wired inside the adapter.
 */
export const useConnectWallet = useConnectWalletProvider;
