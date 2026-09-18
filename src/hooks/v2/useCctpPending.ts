"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import {
  cctpPendingKey,
  dismissCctpPending,
  readCctpPending,
  removeCctpPending,
  subscribeCctpPending,
  type PendingCctp,
} from "@/lib/bridge/cctpPending";
import { isCctpMinted } from "@/lib/bridge/cctpAttestation";

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
  /** Hide one transfer's bar without deleting it (the user's close button). */
  dismiss: (txHash: string) => void;
  isConnected: boolean;
  /** Whether the server completes mints for the user — see /api/cctp/status. */
  keeper: boolean;
} {
  const { address, isConnected } = useWalletV2();
  const [pending, setPending] = useState<PendingCctp[]>([]);
  const [keeper, setKeeper] = useState(false);

  /* The self-clear. A CCTP mint can be completed by the user, our keeper, OR a
     public relayer (measured: a third party finished a real transfer for
     free), so the bar cannot clear off our own records alone — it reads the
     CHAIN. Every 30s, for each pending burn, isCctpMinted asks whether the
     mint is already done on the destination; if so the row leaves the list —
     with a word to the user unless they had dismissed it. The one server call
     left is for the `keeper` flag the banner's copy turns on, not for
     clearing. */
  useEffect(() => {
    if (!address || pending.length === 0) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/cctp/status`, { cache: "no-store" });
        if (res.ok && !stopped)
          setKeeper(Boolean(((await res.json()) as { keeper?: boolean }).keeper));
      } catch {
        /* the keeper flag only drives copy; a failed read leaves it as-is */
      }
      for (const entry of pending) {
        if (stopped) return;
        try {
          const minted = await isCctpMinted({
            sourceChainId: entry.sourceChainId,
            destChainId: entry.destChainId,
            txHash: entry.txHash,
          });
          if (minted && !stopped) {
            removeCctpPending(address, entry.txHash);
            if (!entry.dismissedAt)
              toast.success(
                `${entry.amount} ${entry.symbol} landed on ${entry.destChainName}.`,
              );
          }
        } catch {
          /* an inconclusive read leaves the transfer on the list */
        }
      }
    };
    void poll();
    const timer = setInterval(poll, 30_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [address, pending]);

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
  const dismiss = useCallback(
    (txHash: string) => dismissCctpPending(address, txHash),
    [address],
  );

  /* The bar shows only what the user hasn't closed; the effect above still
     polls the full list, so a dismissed transfer is cleaned from storage once
     it mints. */
  const visible = useMemo(
    () => pending.filter((p) => !p.dismissedAt),
    [pending],
  );

  return { pending: visible, remove, dismiss, isConnected, keeper };
}
