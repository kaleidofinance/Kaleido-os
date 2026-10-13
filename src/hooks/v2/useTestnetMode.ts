"use client";

import { useAtom } from "jotai";
import { showTestnetsAtom } from "@/constants/atom";

/**
 * The shared testnet switch.
 *
 * `showTestnets` false is the mainnet-first default the Arc launch runs on;
 * `setShowTestnets` writes the persisted atom, so flipping it in one place — the
 * network switcher — is seen everywhere at once: the faucet nav tab and the
 * /faucet gate included. This hook is the only seam components should touch; see
 * `showTestnetsAtom` for why the preference persists rather than resetting each
 * load.
 */
export function useTestnetMode(): {
  showTestnets: boolean;
  setShowTestnets: (next: boolean | ((prev: boolean) => boolean)) => void;
} {
  const [showTestnets, setShowTestnets] = useAtom(showTestnetsAtom);
  return { showTestnets, setShowTestnets };
}
