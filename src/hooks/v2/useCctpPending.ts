"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
  /** Whether the server completes mints for the user — see /api/cctp/status. */
  keeper: boolean;
} {
  const { address, isConnected } = useWalletV2();
  const [pending, setPending] = useState<PendingCctp[]>([]);
  const [keeper, setKeeper] = useState(false);

  /* The server's side of the story. While anything is pending, ask
     /api/cctp/status every 30s whether the completion keeper has minted it;
     a minted row leaves the local list with a word to the user, so the bar
     never nags about a transfer that already finished. The same call reports
     whether a keeper exists at all, which the banner's copy turns on. */
  useEffect(() => {
    if (!address || pending.length === 0) return;
    let stopped = false;
    const poll = async () => {
      try {
        const tx = pending.map((p) => p.txHash).join(",");
        const res = await fetch(`/api/cctp/status?tx=${encodeURIComponent(tx)}`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const body = (await res.json()) as {
          keeper?: boolean;
          rows?: { txHash: string; status: string }[];
        };
        setKeeper(Boolean(body.keeper));
        for (const row of body.rows ?? []) {
          if (row.status !== "minted") continue;
          const entry = pending.find(
            (p) => p.txHash.toLowerCase() === row.txHash.toLowerCase(),
          );
          if (!entry) continue;
          removeCctpPending(address, entry.txHash);
          toast.success(
            `${entry.amount} ${entry.symbol} minted on ${entry.destChainName} — completed for you.`,
          );
        }
      } catch {
        /* A status read that fails changes nothing on screen. */
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

  return { pending, remove, isConnected, keeper };
}
