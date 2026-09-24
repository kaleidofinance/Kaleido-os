"use client";

import { useCallback, useEffect, useState } from "react";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { MOCK_DATA, mockTxLog, mockTxLogClear } from "@/lib/mock";
import {
  clearTxLog,
  readTxLog,
  recordTx,
  subscribeTxLog,
  txLogKey,
  type TxLogEntry,
} from "@/lib/v2/txLog";

/**
 * The connected wallet's transaction log, live.
 *
 * Read scope comes from the wallet, so switching account or network swaps the
 * list rather than merging two histories — see the key note in lib/v2/txLog.ts.
 */
export function useTxLog() {
  const { address, chainId, isConnected } = useWalletV2();
  const [entries, setEntries] = useState<TxLogEntry[]>([]);

  useEffect(() => {
    if (!chainId || !address) {
      setEntries([]);
      return;
    }
    const key = txLogKey(chainId, address);
    /* Fixture log substituted at the read, not seeded into storage — a fixture row
       written to the key would survive the flag being off, and a hash cannot carry
       a recognisable prefix. Inside `load` rather than above the effect on purpose:
       both subscriptions below stay live, so Clear and a write from another tab
       still re-read. Deleting ./mock leaves `readTxLog(chainId, address)`. */
    const load = () =>
      setEntries(
        MOCK_DATA ? mockTxLog(chainId, address) : readTxLog(chainId, address),
      );
    load();

    /* Same-tab writes: PlanReview records a step and this re-reads. */
    const off = subscribeTxLog((changed) => {
      if (changed === key) load();
    });
    /* Other tabs: a real StorageEvent, which fires everywhere except the tab
       that wrote — the two listeners are complements, not alternatives. */
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) load();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      off();
      window.removeEventListener("storage", onStorage);
    };
    /* Loading in an effect rather than a useState initializer is what keeps this
       hydration-safe. These components render on the server too, where
       localStorage does not exist; a value that materialises only on the client
       is a mismatch, which is the same trap the lending table's time-until
       strings had to be gated for. The first client render sees an empty log and
       the effect fills it a tick later. */
  }, [chainId, address]);

  /* A pending row can outlive the page that created it. Reconcile it after
     reconnect/reload so the history does not remain stuck on Pending forever.
     The provider is loaded lazily because this hook also renders disconnected
     states where no chain RPC is needed. */
  useEffect(() => {
    if (!chainId || !address || MOCK_DATA || entries.every((entry) => entry.status !== "pending")) return;
    let cancelled = false;
    const reconcile = async () => {
      const { providerForChain } = await import("@/config/provider");
      const provider = providerForChain(chainId);
      if (!provider || cancelled) return;
      const pending = entries.filter((entry) => entry.status === "pending");
      await Promise.all(pending.map(async (entry) => {
        try {
          const receipt = await provider.getTransactionReceipt(entry.hash);
          if (cancelled || !receipt || (receipt.status !== 0 && receipt.status !== 1)) return;
          recordTx(chainId, address, {
            ...entry,
            status: receipt.status === 1 ? "confirmed" : "reverted",
            at: Date.now(),
          });
        } catch {
          /* A temporary RPC failure leaves the row pending for the next poll. */
        }
      }));
    };
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [entries, chainId, address]);

  const clear = useCallback(() => {
    /* One line, deleted with the seam above. `clearTxLog` still runs and still
       emits, which is what tells the subscriber to re-read; this is only what makes
       the re-read come back empty. */
    if (MOCK_DATA) mockTxLogClear();
    clearTxLog(chainId, address);
  }, [chainId, address]);

  return { entries, clear, isConnected };
}
