"use client";

import { useCallback } from "react";
import { ethers } from "ethers";
import { useV3SwapRouter } from "@/hooks/dex/useV3SwapRouter";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { readFaucetAssets } from "@/hooks/v2/useFaucet";
import { readMarketRow } from "@/lib/lending/book";
import { readPoolState } from "@/lib/dex/pool";
import { providerForChain } from "@/config/provider";
import { getContracts } from "@/constants/registry";
import {
  buildIntents,
  type FaucetAssetRef,
  type MarketRow,
  type PlanResult,
  type PlannerOptions as BuilderOptions,
  type LoanRef,
  type PoolPositionRef,
} from "@/lib/v2/intents/build";
import type { Command } from "@/lib/v2/intents/fromCommand";

/**
 * Client half of the planner: fetches what a plan needs, then hands off.
 *
 * Intent shaping lives in lib/v2/intents/build.ts, not here. It moved because
 * of the "use client" directive above — /api/chat could not import this file
 * without pulling thirdweb and React into the server bundle, so the AI path
 * had no builder to call and asked the model for raw contract addresses
 * instead. One builder, two callers: this one supplies browser-provider reads,
 * the chat route supplies read-only-provider ones.
 *
 * What stays here is exactly what cannot be pure: a quote through the wallet's
 * provider, the caller-held position and loan lists, and two lazy chain reads for
 * the order book and the faucet. Quotes are the reason planning is async at all,
 * which is why parsing (fromCommand, pure) and planning (this) are separate
 * modules.
 */

export type {
  PlanBuild,
  PlanResult,
  LoanRef,
  PoolPositionRef,
} from "@/lib/v2/intents/build";
export { isParsableAmount } from "@/lib/v2/intents/build";

export interface PlannerOptions extends BuilderOptions {
  /** Open loans, so a bare "repay" can resolve to one without asking. */
  loans?: LoanRef[];
  /** The wallet's V3 positions, so collect/remove can find one by tokenId. */
  positions?: PoolPositionRef[];
}

/**
 * One listing or request, from the diamond on the connected chain.
 *
 * Delegates to `readMarketRow`, which is the same function /api/chat's
 * `serverPlanDeps` calls — the same rule `browserFaucetAssets` below follows, and
 * here it is load-bearing rather than tidy: "take listing 1" resolving in the
 * chat and being refused on the agent page would be a worse state than either
 * source being wrong on its own.
 *
 * This used to `fetch('/api/listings?searchId=…')`, i.e. the Supabase mirror the
 * Borrow page browses. That mirror held zero rows while Sepolia's diamond held an
 * OPEN listing and an OPEN request — measured 2026-08-25 — so the planner refused
 * orders with real tokens escrowed in them. book.ts has the full account.
 */
async function fetchMarketRow(
  chainId: number | undefined,
  kind: "listings" | "requests",
  id: number,
): Promise<MarketRow | null> {
  return readMarketRow(providerForChain(chainId), chainId, kind, id);
}

/**
 * What the faucet on the connected chain lists.
 *
 * Delegates to readFaucetAssets, which is the same function the /faucet page's
 * hook uses — the drips, stock and cooldown deadlines a typed "faucet usdt" is
 * checked against are read exactly the way the page reads them, so the two can
 * never disagree about what is claimable.
 *
 * Empty on a chain with no faucet, no RPC, or a failed read. build.ts turns each
 * of those into a refusal that names the reason.
 */
async function browserFaucetAssets(
  chainId: number | undefined,
  address: string | undefined,
): Promise<FaucetAssetRef[]> {
  const provider = providerForChain(chainId);
  if (!provider || !chainId || !getContracts(chainId).faucet) return [];
  return readFaucetAssets(provider, chainId, address ?? ethers.ZeroAddress);
}

export function useLocalPlanner() {
  const { getV3AmountOut } = useV3SwapRouter();
  const { chainId, address } = useWalletV2();

  const buildPlan = useCallback(
    async (command: Command, opts: PlannerOptions): Promise<PlanResult> =>
      buildIntents(
        command,
        { slippageBps: opts.slippageBps, deadlineMin: opts.deadlineMin },
        {
          chainId,
          quote: (q) =>
            getV3AmountOut(
              q.tokenIn,
              q.tokenOut,
              q.amountIn,
              q.fee,
              q.decimalsIn,
              q.decimalsOut,
            ) as Promise<string | number | null>,
          marketRow: (kind, id) => fetchMarketRow(chainId, kind, id),
          positions: async () => opts.positions ?? [],
          loans: async () => opts.loans ?? [],
          /* Read here rather than passed in, and read lazily, which is the whole
             reason PlanDeps takes thunks: the faucet is one more eth_call, and
             an agent page that fired it on mount would pay for it on every visit
             to serve the one command in twenty that mentions a faucet. */
          faucetAssets: () => browserFaucetAssets(chainId, address),
          /* The same reader the /pool/new range picker uses, so a "±10% band"
             asked for in the chat centres on the price the page would have shown.
             Chain-scoped through `chainId`, which is the wallet's — the hook this
             replaced resolved its factory from READ_ONLY_CHAIN_ID while minting on
             the wallet's chain. */
          poolState: (tokenA, tokenB, fee, decimalsA, decimalsB) =>
            readPoolState(
              providerForChain(chainId),
              chainId,
              tokenA,
              tokenB,
              fee,
              decimalsA,
              decimalsB,
            ),
        },
      ),
    [getV3AmountOut, chainId, address],
  );

  return { buildPlan };
}
