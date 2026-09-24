"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { readLifiPending, removeLifiPending, type LifiPending } from "@/lib/bridge/lifiPending";

/** Reconciles persisted LI.FI source broadcasts with destination status. */
export function useLifiPending(): LifiPending[] {
  const { address } = useWalletV2();
  const [rows, setRows] = useState<LifiPending[]>([]);

  useEffect(() => {
    if (!address) { setRows([]); return; }
    let stopped = false;
    const load = () => setRows(readLifiPending(address));
    const poll = async () => {
      const current = readLifiPending(address);
      if (!stopped) setRows(current);
      for (const row of current) {
        try {
          const res = await fetch(`/api/bridge/status?tx=${row.txHash}&from=${row.sourceChainId}&to=${row.destinationChainId}`, { cache: "no-store" });
          const data = (await res.json()) as { status?: string; destinationTxHash?: string | null };
          if (stopped) return;
          if (data.status === "DONE") {
            removeLifiPending(address, row.txHash);
            toast.success(`${row.amount} ${row.symbol} arrived on ${row.destinationChainName}.`);
          } else if (data.status === "FAILED") {
            toast.error(`LI.FI bridge to ${row.destinationChainName} needs attention.`);
          }
        } catch { /* leave the route pending for the next poll */ }
      }
      if (!stopped) load();
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 30_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [address]);

  return rows;
}
