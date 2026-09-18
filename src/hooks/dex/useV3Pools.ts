"use client";

/**
 * KaleidoSwap V3 pools, read without a wallet, on every chain we deployed to.
 *
 * The pools table sat above a New position button that mints V3 and listed only
 * V2, so every pool this protocol has actually opened was invisible in the
 * product that opened it. This is the sweep that fixes that.
 *
 * WHY A SWEEP AND NOT A `PoolCreated` SCAN
 *
 * V3 has no `allPairs(i)`. The two ways to enumerate it are scanning
 * `PoolCreated` from the factory's deployment block, or asking the factory for
 * every pool a token list could form. The scan is the better answer in principle
 * and unavailable in practice: no deployment block is recorded for any of the
 * five factories, so a scan would have to walk from genesis in 1000-block chunks
 * — the widest range the read chain's node serves, so tens of thousands of
 * requests — or guess a start and silently miss anything older.
 *
 * The sweep asks `getPool(a, b, tier)` for every unordered pair of registered
 * tokens at every tier this app trades. On one chain that is 8 tokens → 28
 * pairs × 3 tiers = 84 `eth_call`s, once per 30s cache window, shared by every
 * consumer through the same module-scope cache `usePoolData` uses. Cheap, bounded
 * and needs no history.
 *
 * EVERY DEPLOYED CHAIN, NOT THE READ CHAIN ALONE
 *
 * That sweep runs once per chain over `discoveryChains()`, so the cost above is
 * per chain too — five of them is ~420 `eth_call`s a window, spread across five
 * endpoints at four in flight each. What it replaces is worse than expensive: one
 * chain's pools under a heading that reads "All pools", with every pool we opened
 * on the other four simply absent. `@/lib/dex/poolDiscovery` holds the fan-out and
 * why it is not a `Promise.all` — rows publish per chain as they land, a chain that
 * fails contributes nothing rather than failing the list, and each chain has a
 * deadline so one unhealthy endpoint cannot hold the sweep open.
 *
 * Each pool stamps the chain it was read from into `ITradingPair.chainId`. That is
 * what lets a row carry a chain tag, and what lets the detail page read a pool's
 * own logs through that pool's own provider rather than the read chain's.
 *
 * WHAT THE SWEEP CANNOT SEE, STATED RATHER THAN HIDDEN
 *
 * A pool between two tokens the registry does not carry on this chain, or at a
 * fee tier outside `FEE_TIERS`. Both are reachable on chain — `createPool` is
 * permissionless and `enableFeeAmount` can add a tier — and neither is reachable
 * from this app's own UI, which is why the bound is drawn here. `usePoolData` has
 * no equivalent gap because `allPairs(i)` hands back pairs of tokens it has never
 * heard of and it reads their metadata off the chain.
 *
 * And a probe the node refused. `readPoolState` returns null for "no pool at this
 * tier" and for "the read failed" alike, deliberately — see its own note — so a
 * rate-limited chain reports as a chain with no pools rather than as an error.
 * That is not hypothetical: measured 2026-08-28, Arc's endpoint answered 60 of 135
 * batched `getPool` calls and refused the rest with `-32005 rate limit exceeded`,
 * and Base Sepolia threw away all three of its pools on the `balanceOf` batch below
 * with `-32016 over rate limit`, then showed them again 30s later.
 *
 * Both reads now go through `retryRpc`, which backs off and asks again while — and
 * only while — the refusal looks like throttling, so the common case is recovered
 * inside one sweep instead of on the next one. What it cannot promise is that a
 * chain refusing every request for the whole window will not still read as empty.
 * That residue is why the row count for a throttling chain is the one number on
 * this page that is a lower bound rather than a measurement.
 *
 * PRICING A POOL WHOSE ONLY PRICE IS ITS OWN
 *
 * V2 values a half-priced pool by doubling the priced leg, which is sound because
 * every KaleidoSwap V2 pair is constant product. That does not transfer: a V3
 * position is concentrated, so its two legs are not equal in value at any price
 * and doubling one would invent a number. Instead the unpriced leg is valued
 * through the pool's own quote — for a KLD/USDC pool that means KLD is worth
 * whatever USDC the pool trades it for, which is exact arithmetic rather than an
 * assumption about the curve. The cost is that such a pool cannot show drift
 * against spot, because one of its two legs now comes from the pool itself;
 * `ITradingPair.value0` says so.
 */

import { useCallback, useEffect, useState } from "react";

import { CHAINS_BY_ID } from "@/constants/chains";
import { useTestnetMode } from "@/hooks/v2/useTestnetMode";
import type { ITradingPair } from "@/constants/types/dex";
import { createPoolStore } from "@/lib/dex/poolDiscovery";
import { fetchSpotPricesSoon, priceLookup } from "@/lib/market/spot";
import { MOCK_DATA } from "@/lib/mock";
import { sweepChain } from "@/lib/dex/poolSweep";

const CACHE_DURATION = 30_000;

/* Shared with every consumer, same contract as usePoolData's: the strip, the
 * table and the detail page are three views of one fetch and must not disagree.
 * Keyed by chain inside, so one chain's pools can land while another is still
 * being read — see createPoolStore. */
const store = createPoolStore(CACHE_DURATION);


export interface V3PoolsResult {
  pools: ITradingPair[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useV3Pools(): V3PoolsResult {
  /* The shared sweep reads every deployed chain; a mainnet-first viewer should
     not see testnet pools in the list. Filtered per consumer off the toggle so
     the sweep stays shared and a flip re-renders without re-sweeping. */
  const { showTestnets } = useTestnetMode();
  const [pools, setPools] = useState<ITradingPair[]>(() => store.snapshot());
  const [loading, setLoading] = useState(store.snapshot().length === 0);
  const [error, setError] = useState<string | null>(null);

  /* Subscribed for as long as this consumer is mounted rather than only while its
     own sweep runs: one sweep serves the strip, the table and the detail page, and
     it publishes chain by chain. A consumer listening only to its own call would
     hold the first chain's rows while the rest arrived for someone else. */
  useEffect(() => store.subscribe(setPools), []);

  const fetchPools = useCallback(async (force = false) => {
    /* Demo mode has no V3 fixtures. Returning nothing rather than borrowing
       MOCK_POOLS: those are V2 pairs with V2 addresses, and relabelling them
       would put the same pool on the table twice under two badges. */
    if (MOCK_DATA) {
      setPools([]);
      setError(null);
      setLoading(false);
      return;
    }

    try {
      /* Refresh in the background once a snapshot exists. Toggling loading here
         makes the pool table visibly flash/rebuild every 30 seconds even when
         the server returns the same cached snapshot. */
      if (store.snapshot().length === 0) setLoading(true);
      setError(null);

      /* Mainnet-first is the default, and /api/pools serves exactly that set —
         swept once on the server and shared across every tab, instead of every
         browser fanning hundreds of getPool calls into Arc's rate-limited RPC.
         Try it first; on any failure (or a testnet viewer, whom the endpoint does
         not serve) fall through to the client sweep below, unchanged. */
      if (!showTestnets && !MOCK_DATA) {
        try {
          const res = await fetch("/api/pools", { cache: "no-store" });
          if (res.ok) {
            const body = (await res.json()) as {
              pools?: ITradingPair[];
              error?: string;
            };
            if (Array.isArray(body.pools) && !body.error) {
              store.replace(body.pools);
              setPools(store.snapshot());
              return;
            }
          }
        } catch {
          /* Endpoint unreachable — fall through to the client sweep. */
        }
      }

      /* Prices once for the whole sweep, then one call per chain. The price table
         is keyed by symbol and has no cache of its own, so fetching it inside the
         per-chain work would hit /api/prices/spot five times for one answer. */
      setPools(
        await store.sweep(
          async () => priceLookup(await fetchSpotPricesSoon()),
          (chain, priceOf) => sweepChain(chain, priceOf),
          force,
          /* Mainnet-first: don't sweep testnet RPCs when they're hidden — see
             PoolStore.sweep. Reading them 429'd five testnet endpoints and hung
             the table for a viewer who could only see mainnet rows anyway. */
          !showTestnets,
        ),
      );
    } catch (err) {
      /* Only reached when every chain failed — see PoolStore.sweep. A single dead
         endpoint is logged there and leaves the other chains' rows on screen. */
      console.error("Error fetching V3 pools:", err);
      setError(
        err instanceof Error ? err.message : "Failed to fetch V3 pools",
      );
    } finally {
      setLoading(false);
    }
  }, [showTestnets]);

  useEffect(() => {
    fetchPools();
    const interval = setInterval(() => void fetchPools(false), CACHE_DURATION);
    return () => clearInterval(interval);
  }, [fetchPools]);

  return {
    pools: pools.filter(
      (p) => showTestnets || CHAINS_BY_ID[p.chainId]?.network === "mainnet",
    ),
    loading,
    error,
    refetch: () => fetchPools(true),
  };
}
