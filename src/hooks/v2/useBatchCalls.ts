"use client";

import { useWalletBatch } from "@/lib/wallet";
import type { BatchResult, BatchSupport } from "@/lib/wallet";
import type { BatchCall } from "@/lib/v2/intents/batch";

/**
 * Whether the connected wallet can sign several calls under one approval, and a
 * function to do it.
 *
 * A thin bridge over the provider-agnostic `@/lib/wallet` facade, kept at this
 * path so `PlanReview` does not change. The EIP-5792 mechanics — capability
 * probing and the atomic-batch send, and the reasons they are shaped that way —
 * live in the active wallet adapter (`src/lib/wallet/adapters/thirdweb.tsx`).
 * The one property to remember: batching is gated on the wallet's declared
 * capability, not on whether `sendCalls` resolved, and callers always keep the
 * sequential fallback because the feature is additive.
 */
export type { BatchResult, BatchSupport };

export function useBatchCalls(): {
  support: BatchSupport;
  send: (calls: BatchCall[]) => Promise<BatchResult>;
} {
  return useWalletBatch();
}
