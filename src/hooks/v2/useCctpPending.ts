"use client";

import { useCallback, useEffect, useState } from "react";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import {
  cctpPendingKey,
  readCctpPending,
  removeCctpPending,
  subscribeCctpPending,
  type PendingCctp,
} from "@/lib/bridge/cctpPending";

/**
 * The connected wallet's not-yet-completed CCTP transfers, live.
 *
 * Wallet-scoped and NOT chain-scoped — a pending transfer is read from the
 * destination chain where it is completed, not only the source chain where it
 * was burned — so switching networks keeps the same list, unlike useTxLog.
 * Hydration-safe the same way: the read happens in an effect, so the server
 * render and the first client render both see an empty list and the rows fill a
 * tick later, rather than a value that exists only on the client.
 */
export function useCctpPending(): {
  pending: PendingCctp[];
  remove: (txHash: string) => void;
  isConnected: boolean;
} {
  const { address, isConnected } = useWalletV2();
  const [pending, setPending] = useState<PendingCctp[]>([]);

  useEffect(() => {
    if (!address) {
      setPending([]);
      return;
    }
    const key = cctpPendingKey(address);
    const load = () => setPending(readCctpPending(address));
    load();

    /* Same-tab writes: PlanReview records a burn and this re-reads. */
    const off = subscribeCctpPending((changed) => {
      if (changed === key) load();
    });
    /* Other tabs: a real StorageEvent, which fires everywhere except the writer
       — the complement of the emitter above. */
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) load();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      off();
      window.removeEventListener("storage", onStorage);
    };
  }, [address]);

  const remove = useCallback(
    (txHash: string) => removeCctpPending(address, txHash),
    [address],
  );

  return { pending, remove, isConnected };
}
