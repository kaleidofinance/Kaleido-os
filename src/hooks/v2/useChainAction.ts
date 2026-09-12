"use client";

import { useState } from "react";
import { defineChain } from "thirdweb/chains";
import {
  useActiveAccount,
  useActiveWalletChain,
  useConnectModal,
  useSwitchActiveWalletChain,
} from "thirdweb/react";
import { toast } from "sonner";
import { client } from "@/config/client";
import { WALLETS } from "@/config/wallets";
import { getChainMeta, toThirdwebChainOptions } from "@/constants/chains";
import { isSupportedChain } from "@/config/chain";

/**
 * The wallet-chain gate every action surface shares.
 *
 * Swap, the lending forms and limit each grew their own copy of the same three
 * moves — is the wallet on the right chain, switch it if not, then act — and the
 * copies had already drifted (one toasts on a failed switch, one stays silent).
 * This is the single implementation, so the provider underneath (thirdweb today,
 * maybe not tomorrow) is named in ONE place rather than at every CTA. It is also
 * why the reads it needs go through `useActiveAccount`/`useActiveWalletChain`
 * here and nowhere else in a feature component.
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
  const account = useActiveAccount();
  const chain = useActiveWalletChain();
  const switchChain = useSwitchActiveWalletChain();
  const [switching, setSwitching] = useState(false);

  const goTo = targetChainId ?? fallbackChainId;
  const meta = goTo != null ? getChainMeta(goTo) : undefined;
  const target =
    meta?.shortName ??
    meta?.name ??
    (goTo != null ? `chain ${goTo}` : "the right network");

  const wrong =
    !!account &&
    !!chain &&
    (targetChainId !== undefined
      ? chain.id !== targetChainId
      : !isSupportedChain(chain.id));

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
      await switchChain(defineChain(toThirdwebChainOptions(meta)));
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
 * Swap, limit and the ChainGate empty state each inlined the same
 * `connect({ client, wallets: WALLETS, size: "compact" })` with the same
 * catch-and-ignore (dismissing the modal rejects, which is a choice, not a
 * fault). One function, so the wallet list and the client are wired once.
 */
export function useConnectWallet(): () => void {
  const { connect } = useConnectModal();
  return () => {
    connect({ client, wallets: WALLETS, size: "compact" }).catch(() => {
      /* Dismissing the modal rejects — a choice, not a fault. */
    });
  };
}
