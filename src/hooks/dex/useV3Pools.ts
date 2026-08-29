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
import { ethers } from "ethers";

import { getContracts } from "@/constants/registry";
import { chainTokens } from "@/constants/tokens";
import type { IToken, ITradingPair } from "@/constants/types/dex";
import { FEE_TIERS } from "@/lib/dex/liquidity";
import { readPoolTiers, type PoolState } from "@/lib/dex/pool";
import { poolOrderInverted } from "@/constants/utils/v3Math";
import { readVolumeWindow, type VolumeWindow } from "@/lib/dex/logWindow";
import {
  createPoolStore,
  type DiscoveryChain,
} from "@/lib/dex/poolDiscovery";
import {
  fetchSpotPrices,
  priceLookup,
  type PriceLookup,
} from "@/lib/market/spot";
import { retryRpc } from "@/lib/dex/rpcRetry";
import { MOCK_DATA } from "@/lib/mock";

const ERC20_ABI = ["function balanceOf(address) external view returns (uint256)"];

const POOL_ABI = [
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
];

/** `fee()`'s denominator — hundredths of a basis point, so 3000 is 0.30%. */
const V3_FEE_DENOMINATOR = 1_000_000;

/** Basis points of 10000, which is the unit `ITradingPair.feeBps` is in. */
const BPS_DENOMINATOR = 10_000;

/**
 * Pairs probed at once. Each one costs `FEE_TIERS.length` calls, so this is 12
 * `eth_call`s in flight — enough to finish 28 pairs in five waves without asking
 * a public node to answer 84 at once, which is how a free RPC starts returning
 * 429s instead of pools.
 */
const PROBE_CONCURRENCY = 4;

const CACHE_DURATION = 30_000;

/* Shared with every consumer, same contract as usePoolData's: the strip, the
 * table and the detail page are three views of one fetch and must not disagree.
 * Keyed by chain inside, so one chain's pools can land while another is still
 * being read — see createPoolStore. */
const store = createPoolStore(CACHE_DURATION);

const round2 = (n: number | null) =>
  n === null || !Number.isFinite(n) ? null : Number(n.toFixed(2));

/** Every unordered pair of a list, each once. */
function unorderedPairs<T>(items: readonly T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) out.push([items[i], items[j]]);
  }
  return out;
}

/** `Promise.all` with a ceiling on how many run at once. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/**
 * The ERC20s this sweep will pair up.
 *
 * The native asset is dropped rather than mapped to its wrapper: a V3 pool holds
 * WETH, never native, and `chainTokens` already carries WETH as a registered
 * token — including it as both would probe every WETH pair twice. Deduped by
 * address because `registeredTokens` concatenates three sources and USDC is
 * deliberately registered twice on two chains (see `preferRegistryNamed`).
 */
function sweepTokens(chainId: number): IToken[] {
  const seen = new Set<string>();
  const out: IToken[] = [];
  for (const token of chainTokens(chainId)) {
    if (token.isNative) continue;
    if (!ethers.isAddress(token.address)) continue;
    const key = token.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

/** A found pool, still in the caller's token order rather than the pool's. */
interface Found {
  state: PoolState;
  fee: number;
  tokenA: IToken;
  tokenB: IToken;
}

/**
 * How much of `token`'s leg moved through the pool over the window, in USD.
 *
 * V3's `Swap` amounts are signed from the pool's side — positive is what came in
 * — so the absolute value is the leg's size and the sign is direction. Exactly
 * one leg is priced here, which is enough: both sides of a swap are one trade.
 */
async function readWindowVolumeUsd(
  poolAddress: string,
  provider: ethers.Provider,
  window: VolumeWindow,
  leg: 0 | 1,
  decimals: number,
  legPriceUsd: number,
): Promise<number | null> {
  try {
    const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
    const swaps = await pool.queryFilter(
      pool.filters.Swap(),
      window.fromBlock,
      window.toBlock,
    );
    let usd = 0;
    for (const event of swaps) {
      const args = (event as ethers.EventLog).args;
      if (!args) continue;
      const signed = args[leg === 0 ? 2 : 3] as bigint;
      const size = signed < 0n ? -signed : signed;
      usd += Number(ethers.formatUnits(size, decimals)) * legPriceUsd;
    }
    return usd;
  } catch {
    /* Log query refused, or a range the node would not serve. No volume, which
     * is not the same answer as zero volume. */
    return null;
  }
}

async function buildPool(
  found: Found,
  chain: DiscoveryChain,
  priceOf: PriceLookup,
  window: VolumeWindow | null,
): Promise<ITradingPair | null> {
  try {
    const provider = chain.provider;

    /* Pool order, which is address order — the only order the contracts know.
     * Not read back from the pool: `getPool` sorts internally and `token0()` can
     * only ever return the smaller of the two addresses we just handed it, so a
     * call to confirm it would be a round trip to learn something already known.
     * `readPoolState` has already un-inverted `price` into (tokenA, tokenB)
     * order, so it has to be re-inverted here to match token0/token1. */
    const inverted = poolOrderInverted(
      found.tokenA.address,
      found.tokenB.address,
    );
    const token0 = inverted ? found.tokenB : found.tokenA;
    const token1 = inverted ? found.tokenA : found.tokenB;

    const priceAB = found.state.price;
    const price =
      priceAB === null || !Number.isFinite(priceAB) || priceAB <= 0
        ? null
        : inverted
          ? 1 / priceAB
          : priceAB;

    const [balance0, balance1] = await retryRpc(() =>
      Promise.all(
        [token0, token1].map((t) =>
          new ethers.Contract(t.address, ERC20_ABI, provider).balanceOf(
            found.state.address,
          ),
        ),
      ),
    );

    const amount0 = Number(ethers.formatUnits(balance0, token0.decimals));
    const amount1 = Number(ethers.formatUnits(balance1, token1.decimals));

    /* Spot first, then the pool's own quote for whichever leg spot could not
     * price. `price` is token1 per token0, so one token0 is worth `price` token1:
     * that gives either leg from the other with no assumption about the curve.
     * See the header — this is what gives a KLD pool a TVL at all. */
    const spot0 = priceOf(token0.symbol);
    const spot1 = priceOf(token1.symbol);
    let price0 = spot0;
    let price1 = spot1;
    if (price !== null) {
      if (price0 === null && price1 !== null) price0 = price1 * price;
      else if (price1 === null && price0 !== null) price1 = price0 / price;
    }

    const value0 = price0 === null ? null : amount0 * price0;
    const value1 = price1 === null ? null : amount1 * price1;
    /* Both or neither. One leg doubled is a constant-product inference and this
     * curve is not constant product; with the derivation above, "one leg priced"
     * only survives when the pool has no quote either, and then there is nothing
     * to build a total from. */
    const liquidityUsd =
      value0 !== null && value1 !== null ? value0 + value1 : null;

    let volume24h: number | null = null;
    let fees24h: number | null = null;
    let apr: number | null = null;

    /* The priced leg for volume must come from spot, not from the derivation
     * above: pricing a leg off the pool and then measuring the pool's volume in
     * that unit would report volume in terms of itself. */
    const pricedLeg: 0 | 1 | null = spot0 !== null ? 0 : spot1 !== null ? 1 : null;
    if (window && pricedLeg !== null) {
      const windowUsd = await readWindowVolumeUsd(
        found.state.address,
        provider,
        window,
        pricedLeg,
        pricedLeg === 0 ? token0.decimals : token1.decimals,
        (pricedLeg === 0 ? spot0 : spot1) as number,
      );
      if (windowUsd !== null) volume24h = windowUsd * window.scale;
    }

    /* Converted into bps of 10000 so one column formats both venues. Range-checked
     * rather than trusted for the same reason usePoolData checks `swapFee()`: a
     * fee at or above its denominator would make `fees24h` exceed the volume that
     * produced it. */
    const feeBps =
      found.fee > 0 && found.fee < V3_FEE_DENOMINATOR
        ? (found.fee / V3_FEE_DENOMINATOR) * BPS_DENOMINATOR
        : null;

    if (volume24h !== null && feeBps !== null) {
      fees24h = volume24h * (feeBps / BPS_DENOMINATOR);
    }
    if (fees24h !== null && liquidityUsd !== null && liquidityUsd > 0) {
      apr = ((fees24h * 365) / liquidityUsd) * 100;
    }

    return {
      address: found.state.address,
      chainId: chain.chainId,
      version: "v3",
      token0,
      token1,
      reserves: {
        reserve0: balance0.toString(),
        reserve1: balance1.toString(),
      },
      price,
      /* No fungible LP supply exists on V3 — see ITradingPair.totalSupply. The
       * pool's in-range `liquidity()` is a different quantity in different units
       * and reporting it here would be mislabelling it. */
      totalSupply: null,
      volume24h: round2(volume24h),
      volumeWindowSec: window ? window.spanSec : null,
      liquidity: round2(liquidityUsd),
      value0: round2(value0),
      value1: round2(value1),
      fees24h: round2(fees24h),
      apr: round2(apr),
      feeBps,
    } satisfies ITradingPair;
  } catch (e) {
    console.error(`Error building V3 pool ${found.state.address}:`, e);
    return null;
  }
}

/**
 * Every V3 pool one chain carries, in the pairs and tiers this app trades.
 *
 * One chain's whole share of the sweep, so a caller can run five of these
 * independently and publish whichever finishes first. A chain with no V3 factory
 * recorded returns immediately and costs no requests at all — three of the five
 * deployments have never had a pool opened on them, and probing 84 addresses to
 * learn that is a waste on every refresh.
 */
async function sweepChain(
  chain: DiscoveryChain,
  priceOf: PriceLookup,
): Promise<ITradingPair[]> {
  if (!getContracts(chain.chainId).v3Factory) return [];

  const tokens = sweepTokens(chain.chainId);
  if (tokens.length < 2) return [];

  /* A window this chain's node will not give up is survivable: the pools still
     list, with no volume rather than no pools. Volume is one column and it is
     already nullable; the pools are the page. */
  const window = await readVolumeWindow(chain.provider).catch(() => null);

  const probed = await mapLimit(
    unorderedPairs(tokens),
    PROBE_CONCURRENCY,
    async ([tokenA, tokenB]) => {
      const tiers = await readPoolTiers(
        chain.provider,
        chain.chainId,
        tokenA.address,
        tokenB.address,
        FEE_TIERS,
        tokenA.decimals,
        tokenB.decimals,
      );
      return [...tiers.entries()].map(
        ([fee, state]): Found => ({ state, fee, tokenA, tokenB }),
      );
    },
  );

  const built = await Promise.all(
    probed.flat().map((found) => buildPool(found, chain, priceOf, window)),
  );

  return built.filter((p): p is ITradingPair => p !== null);
}

export interface V3PoolsResult {
  pools: ITradingPair[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useV3Pools(): V3PoolsResult {
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
      setLoading(true);
      setError(null);

      /* Prices once for the whole sweep, then one call per chain. The price table
         is keyed by symbol and has no cache of its own, so fetching it inside the
         per-chain work would hit /api/prices/spot five times for one answer. */
      setPools(
        await store.sweep(
          async () => priceLookup(await fetchSpotPrices()),
          (chain, priceOf) => sweepChain(chain, priceOf),
          force,
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
  }, []);

  useEffect(() => {
    fetchPools();
    const interval = setInterval(() => fetchPools(true), CACHE_DURATION);
    return () => clearInterval(interval);
  }, [fetchPools]);

  return { pools, loading, error, refetch: () => fetchPools(true) };
}
