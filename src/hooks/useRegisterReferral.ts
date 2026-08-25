"use client";

import { useCallback, useState } from "react";
import { isAddress } from "ethers";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";

/**
 * Registers the connected address under an upliner.
 *
 * The on-chain call is owner-gated, so signing happens server-side in
 * /api/referral. This hook previously built a signer in the browser from
 * NEXT_PUBLIC_PRIVATE_KEY, which shipped the Diamond owner key to every
 * visitor in the JS bundle.
 */
export const useRegisterReferral = () => {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const address = activeAccount?.address;

  const [isRegistering, setIsRegistering] = useState(false);

  const registerUpliner = useCallback(
    async (upliner: string) => {
      if (!activeChain || !address) return;
      if (!isAddress(upliner)) return;
      if (upliner.toLowerCase() === address.toLowerCase()) return;

      setIsRegistering(true);
      try {
        const response = await fetch("/api/referral", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ upliner, downliner: address }),
        });

        const result = await response.json().catch(() => null);

        if (!response.ok) {
          // Referral registration is a background courtesy triggered by a URL
          // param — a failure shouldn't interrupt the user with a toast.
          console.error(
            "Referral registration failed:",
            result?.error ?? response.status,
          );
          return;
        }

        return result?.status as
          | "registered"
          | "already_registered"
          | undefined;
      } catch (error) {
        console.error("Referral registration failed:", error);
      } finally {
        setIsRegistering(false);
      }
    },
    [activeChain, address],
  );

  return {
    registerUpliner,
    isRegistering,
  };
};
