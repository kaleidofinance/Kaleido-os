"use client";

import { useCallback, useEffect, useState } from "react";
import { useActiveAccount, useActiveWallet, useActiveWalletChain } from "thirdweb/react";
import {
  getCapabilities,
  sendCalls,
  waitForCallsReceipt,
} from "thirdweb/wallets/eip5792";

import { prepareTransaction } from "thirdweb";

import { client } from "@/config/client";
import type { BatchCall } from "@/lib/v2/intents/batch";

/**
 * Whether the connected wallet can sign several calls under one approval, and a
 * function to do it.
 *
 * ── THE GATE IS THE DECLARED CAPABILITY, NOT WHETHER sendCalls THROWS ─────────
 *
 * This is the one thing to get right in this file. thirdweb's `sendCalls` accepts
 * an array from *every* wallet it supports: when the account cannot batch, its
 * in-app implementation loops and sends each call as its own transaction, then
 * reports `atomic: false` (see thirdweb/wallets/in-app/core/eip5792 —
 * `inAppWalletSendCalls` falls back to `sendAndConfirmTransaction` per call).
 *
 * So "sendCalls resolved" is NOT evidence that the user signed once. A UI that
 * inferred batching from a successful call would tell someone their approve and
 * swap were one transaction while their wallet prompted them twice and produced
 * two hashes — and, worse, would claim atomicity that is not there: the loop can
 * land the approve and fail the swap, which is precisely the half-executed state
 * bundling is supposed to remove.
 *
 * `getCapabilities` is therefore the gate. It is documented as not throwing for
 * unsupported wallets, returning a `message` instead, and EIP-5792's own field is
 * `atomic.status` — `"supported"` or `"ready"` means one atomic transaction,
 * `"unsupported"` means the loop. Only the first two enable the bundled path.
 *
 * ── WHY IT IS ALLOWED TO BE WRONG ────────────────────────────────────────────
 *
 * `supported` is a capability check, so it is advisory: a wallet may still refuse
 * the bundle. Every caller keeps the sequential loop and falls back to it, which
 * is why this hook reports a plain boolean and never blocks anything. The feature
 * is additive — nothing that worked before depends on any of it.
 */

export interface BatchSupport {
  /** True when the wallet declares atomic batching on the active chain. */
  supported: boolean;
  /** Still asking. Callers render the sequential label until this clears. */
  checking: boolean;
}

export interface BatchResult {
  /**
   * One hash per call, in call order, once the bundle confirms.
   *
   * An atomic bundle usually reports a single receipt covering every call, so
   * this is often one hash for two steps. Callers must not assume a hash per
   * step — see the note in PlanReview about recording the same hash twice.
   */
  hashes: string[];
  /** False when the bundle landed but reverted. */
  ok: boolean;
}

export function useBatchCalls(): {
  support: BatchSupport;
  send: (calls: BatchCall[]) => Promise<BatchResult>;
} {
  const wallet = useActiveWallet();
  const account = useActiveAccount();
  const chain = useActiveWalletChain();
  const [support, setSupport] = useState<BatchSupport>({
    supported: false,
    checking: true,
  });

  useEffect(() => {
    if (!wallet || !account || !chain) {
      setSupport({ supported: false, checking: false });
      return;
    }
    let live = true;
    setSupport({ supported: false, checking: true });

    (async () => {
      try {
        const caps = await getCapabilities({ wallet, chainId: chain.id });
        /* The record is keyed by chain id, and `getCapabilities` with a chainId
           returns that chain's entry directly. Both shapes are read because the
           second is what the type says and the first is what a wallet that
           ignores the parameter returns. */
        const forChain = (caps as Record<string, unknown>)[String(chain.id)] ?? caps;
        const atomic = (forChain as { atomic?: { status?: string } })?.atomic;
        /* "ready" means the wallet can upgrade itself to batch on demand and
           will prompt for it; "supported" means it already can. Both end in one
           atomic transaction, which is the property that matters here. */
        const ok =
          atomic?.status === "supported" || atomic?.status === "ready";
        if (live) setSupport({ supported: ok, checking: false });
      } catch {
        /* getCapabilities is documented not to throw for a wallet without
           EIP-5792, but it does throw when the account has no `getCapabilities`
           at all. Either way the answer is the same: no batching, use the path
           that has always worked. */
        if (live) setSupport({ supported: false, checking: false });
      }
    })();

    return () => {
      live = false;
    };
  }, [wallet, account, chain]);

  const send = useCallback(
    async (calls: BatchCall[]): Promise<BatchResult> => {
      if (!wallet || !account || !chain) {
        throw new Error("Connect a wallet to continue.");
      }
      if (calls.length === 0) throw new Error("No calls to send.");

      const result = await sendCalls({
        wallet,
        calls: calls.map((c) =>
          prepareTransaction({
            /* The wallet's own active chain object, not `defineChain(id)`. The
               app registers per-chain RPC through `toThirdwebChainOptions`, and
               rebuilding a chain from its id alone throws that away — which on
               these testnets means falling back to a default endpoint for the one
               call that has to reach the right one. */
            chain,
            client,
            to: c.to,
            data: c.data as `0x${string}`,
            value: c.value,
          }),
        ),
        /*
         * ATOMIC OR NOTHING.
         *
         * `atomicRequired` defaults to false, which asks the wallet to accept a
         * non-atomic execution — the calls may be split, and some may land while
         * others do not. For an approve paired with the action it authorises,
         * that is the worst available outcome: an allowance granted to a router
         * for a swap that never happened, which the user believes they signed as
         * one thing. True makes the wallet refuse rather than half-execute, and a
         * refusal is recoverable — the caller falls back to the sequential loop,
         * where each step has its own prompt and its own visible outcome.
         */
        atomicRequired: true,
      });

      const receipt = await waitForCallsReceipt(result);
      return {
        hashes: (receipt.receipts ?? []).map((r) => r.transactionHash),
        /* `status` is the bundle's, and a bundle that reverted is a failure even
           though the call resolved. Treated as failure unless it says success, so
           an unexpected value is not read as a win. */
        ok: receipt.status === "success",
      };
    },
    [wallet, account, chain],
  );

  return { support, send };
}
