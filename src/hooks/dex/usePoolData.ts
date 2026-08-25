"use client";

/**
 * KaleidoSwap V2 pools, read without a wallet.
 *
 * This hook produced the Pools table's numbers, and most of them were invented:
 *
 *  - It returned `[]` unless `window.ethereum` existed, so the public all-pools
 *    table — then on /explore, now on /pool — showed "No pools indexed yet" to
 *    every visitor who had no injected wallet. It now reads through
 *    `readOnlyProvider` unconditionally, which also fixes a wrong-chain bug: the
 *    V2 factory lives at one address on the read chain, so reading it through a
 *    wallet connected to any other chain queried whatever happens to sit at that
 *    address there.
 *  - 24h volume was the 5000-block window's volume times `17.28`. That constant
 *    is 86400/5000, i.e. an assumption that blocks are exactly one second apart.
 *    The window's real duration is now read from the two block timestamps.
 *  - Liquidity was `0` for any pair with neither a stablecoin nor a WETH leg,
 *    which renders identically to an empty pool. Both legs are now priced
 *    through the shared price table and an unpriceable pool reports null.
 *  - ETH was priced at a hardcoded `3000` in two places — once as a fallback
 *    when the old `useEthPrice` hook had not resolved, and once, unconditionally,
 *    inside the volume loop. That hook is deleted: this was its only consumer,
 *    and it kept the same `3000` on a failed read, so it could not tell a caller
 *    it had no price.
 *  - `pair.stable()` does not exist on KaleidoSwapPair. The call was wrapped in
 *    `.catch(() => false)`, so the flag was always false: every pool rendered
 *    "Volatile" and every fee used 0.3%. There is no stable-swap curve in
 *    `contracts/dex/` at all — `KaleidoSwapPair.sol:243-247` enforces constant
 *    product for every pair — and the fee is per-pair state readable as
 *    `swapFee()`, so both are now taken from the contract.
 *  - `volumeChange24h`, `liquidityChange24h` and `createdAt` were `0`, `0` and
 *    `Date.now()`. No historical snapshot exists to compute a change from, and
 *    the creation block was never read. They are gone rather than nulled: a
 *    field that can only ever hold a fabrication is not a field.
 */

import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContracts } from "@/constants/registry";
import { ITradingPair } from "@/constants/types/dex";
import { chainTokenByAddress } from "@/constants/tokens";
import { READ_ONLY_CHAIN_ID, readOnlyProvider } from "@/config/provider";
import {
  fetchSpotPrices,
  priceLookup,
  type PriceLookup,
} from "@/lib/market/spot";
import { MOCK_DATA, MOCK_POOLS } from "@/lib/mock";

const FACTORY_ABI = [
  "function allPairsLength() external view returns (uint)",
  "function allPairs(uint) external view returns (address)",
];

const PAIR_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function totalSupply() external view returns (uint256)",
  "function swapFee() external view returns (uint32)",
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
];

const ERC20_ABI = [
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
  "function decimals() external view returns (uint8)",
];

// Global cache to prevent multiple concurrent fetches
let cachedPools: ITradingPair[] = [];
let lastFetchTime = 0;
let activeFetchPromise: Promise<ITradingPair[]> | null = null;
const CACHE_DURATION = 30_000; // 30 seconds

/** `queryFilter` span. Most RPC providers reject a much wider range outright. */
const VOLUME_WINDOW_BLOCKS = 5000;

const DAY_SEC = 86_400;

/**
 * Shortest sample worth extrapolating from.
 *
 * Scaling to a day multiplies whatever the window contains by `86400/span`, so
 * a two-minute window multiplies a single trade by 720. Below this the figure
 * carries less information than the em dash that replaces it.
 */
const MIN_WINDOW_SEC = 600;

/** `swapFee()`'s denominator — KaleidoSwapPair.sol:243. */
const FEE_DENOMINATOR = 10_000;

const round2 = (n: number | null) =>
  n === null || !Number.isFinite(n) ? null : Number(n.toFixed(2));

interface VolumeWindow {
  fromBlock: number;
  toBlock: number;
  /** Real seconds between the two blocks, from their own timestamps. */
  spanSec: number;
  /** Multiplier onto a day. Below 1 when the sample already spans longer. */
  scale: number;
}

/**
 * The block range volume is sampled over, and how long it really lasted.
 *
 * Fetched once per refresh and shared by every pool, so the two extra block
 * reads cost nothing per pair. Returns null when the range is unusable — a
 * chain younger than the window, a node reporting non-monotonic timestamps, or
 * a span too short to extrapolate from — and the caller reports no volume at
 * all rather than a scaled guess.
 */
async function readVolumeWindow(
  provider: ethers.Provider,
): Promise<VolumeWindow | null> {
  const head = await provider.getBlock("latest");
  if (!head) return null;

  const fromBlock = Math.max(0, head.number - VOLUME_WINDOW_BLOCKS);
  if (fromBlock >= head.number) return null;

  const tail = await provider.getBlock(fromBlock);
  if (!tail) return null;

  const spanSec = head.timestamp - tail.timestamp;
  if (!Number.isFinite(spanSec) || spanSec < MIN_WINDOW_SEC) return null;

  return {
    fromBlock,
    toBlock: head.number,
    spanSec,
    /* Below 1 when the window covers more than a day, which averages the sample
     * down instead of up. Slow blocks make that the normal case: 5000 blocks at
     * 30s apart is 41 hours. */
    scale: DAY_SEC / spanSec,
  };
}

/** ERC20 metadata for a token the registry does not carry on this chain. */
async function readTokenMetadata(
  address: string,
  provider: ethers.Provider,
  chainId: number,
) {
  const contract = new ethers.Contract(address, ERC20_ABI, provider);
  const [symbol, name, decimals] = await Promise.all([
    contract.symbol(),
    contract.name(),
    contract.decimals(),
  ]);
  return {
    address,
    symbol,
    name,
    decimals: Number(decimals),
    chainId,
    verified: false,
    logoURI: "",
  };
}

export const usePoolData = () => {
  const [pools, setPools] = useState<ITradingPair[]>(cachedPools);
  const [loading, setLoading] = useState(cachedPools.length === 0);
  const [error, setError] = useState<string | null>(null);

  const fetchPools = useCallback(async (force = false) => {
    /*
     * Demo mode. First statement in the fetch, so no provider is ever created
     * and the module-level cache stays empty — the initial state is still `[]`,
     * which keeps the fixtures out of the server-rendered pass. Every figure
     * below is arithmetically consistent with its own reserves; see src/lib/mock.
     * Delete this block with that directory.
     */
    if (MOCK_DATA) {
      setPools(MOCK_POOLS);
      setError(null);
      setLoading(false);
      return;
    }

    // If there's an active fetch, wait for it
    if (activeFetchPromise) {
      try {
        const result = await activeFetchPromise;
        setPools(result);
        setLoading(false);
        return;
      } catch (e) {
        // Fall through to retry if it failed
      }
    }

    // Check cache
    const now = Date.now();
    if (
      !force &&
      cachedPools.length > 0 &&
      now - lastFetchTime < CACHE_DURATION
    ) {
      setPools(cachedPools);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Create a new fetch promise
      activeFetchPromise = (async () => {
        /* `readOnlyProvider`, not the wallet's. The V2 factory is resolved for
         * READ_ONLY_CHAIN_ID from the registry, not the wallet's chain: a
         * discovery page should show the same pools to a visitor as to a
         * connected user, so which chain it reads is configuration, not a choice
         * the wallet gets to make. Reading a factory address through a wallet on
         * some other chain would query whatever code happens to sit there. */
        const provider = readOnlyProvider;
        const chainId = READ_ONLY_CHAIN_ID;
        const v2Factory = getContracts(chainId).v2Factory;
        if (!v2Factory) {
          return [];
        }

        const factory = new ethers.Contract(v2Factory, FACTORY_ABI, provider);

        const pairsLength = await factory.allPairsLength();
        const pairsCount = Number(pairsLength);

        if (pairsCount === 0) {
          return [];
        }

        // Parallelize address fetching (10x Speedup)
        const pairAddresses: string[] = await Promise.all(
          Array.from({ length: pairsCount }, (_, i) => factory.allPairs(i)),
        );

        /* Prices and the volume window are context for every pool, so both are
         * fetched once. A null price map is not fatal: each figure that needed a
         * price reports null and the table renders an em dash. */
        const [spot, volumeWindow] = await Promise.all([
          fetchSpotPrices(),
          readVolumeWindow(provider),
        ]);
        const priceOf: PriceLookup = priceLookup(spot);

        const poolsData = await Promise.all(
          pairAddresses.map(async (pairAddress) => {
            try {
              const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);

              // Fetch basic pair info in parallel
              const [
                token0Address,
                token1Address,
                reserves,
                totalSupply,
                swapFeeRaw,
              ] = await Promise.all([
                pair.token0(),
                pair.token1(),
                pair.getReserves(),
                pair.totalSupply(),
                pair.swapFee().catch(() => null),
              ]);

              const reserve0 = reserves.reserve0;
              const reserve1 = reserves.reserve1;

              const token0 =
                chainTokenByAddress(chainId, token0Address) ??
                (await readTokenMetadata(token0Address, provider, chainId));
              const token1 =
                chainTokenByAddress(chainId, token1Address) ??
                (await readTokenMetadata(token1Address, provider, chainId));

              const reserve0Formatted = Number(
                ethers.formatUnits(reserve0, token0.decimals),
              );
              const reserve1Formatted = Number(
                ethers.formatUnits(reserve1, token1.decimals),
              );

              /* The pool's own ratio, not a USD price. Null rather than 0 when
               * there is nothing to divide by: an unfunded pool has no price. */
              const price =
                reserve0Formatted > 0
                  ? reserve1Formatted / reserve0Formatted
                  : null;

              const price0 = priceOf(token0.symbol);
              const price1 = priceOf(token1.symbol);

              /* Liquidity.
               *
               * Both legs priced is the exact answer and assumes nothing about
               * the curve — it is the sum of what the pool holds.
               *
               * One leg priced doubles that leg, which is valid only because
               * every KaleidoSwap V2 pair is constant product:
               * KaleidoSwapPair.sol:243-247 enforces
               * `balance0 * balance1 >= reserve0 * reserve1` with the fee folded
               * in, and `contracts/dex/` carries no stable-swap branch. At the
               * pool's own price the two sides hold equal value, so one side
               * doubled is the total.
               *
               * The branch this replaces summed the two reserves raw whenever
               * `pair.stable()` was true — wrong twice over, since the curve is
               * not stable-swap and that function does not exist. */
              let liquidityUsd: number | null = null;
              const value0 =
                price0 !== null ? reserve0Formatted * price0 : null;
              const value1 =
                price1 !== null ? reserve1Formatted * price1 : null;
              if (value0 !== null && value1 !== null) {
                liquidityUsd = value0 + value1;
              } else if (value0 !== null) {
                liquidityUsd = value0 * 2;
              } else if (value1 !== null) {
                liquidityUsd = value1 * 2;
              }

              /* Volume.
               *
               * `amount0In + amount0Out` is the size of a trade's token0 leg: a
               * swap moves token0 one way only, so exactly one of the two is
               * non-zero per event. Pricing either leg prices the trade — both
               * sides of a swap are the same trade.
               *
               * Then scaled to a day by the window's measured duration. The
               * extrapolation is still linear, which assumes the sample is
               * representative; `volumeWindowSec` ships alongside so a consumer
               * can see how much of a day was actually observed. */
              let volume24h: number | null = null;
              let fees24h: number | null = null;
              let apr: number | null = null;

              const pricedLeg =
                price0 !== null ? 0 : price1 !== null ? 1 : null;

              if (volumeWindow && pricedLeg !== null) {
                try {
                  const swapEvents = await pair.queryFilter(
                    pair.filters.Swap(),
                    volumeWindow.fromBlock,
                    volumeWindow.toBlock,
                  );

                  const decimals =
                    pricedLeg === 0 ? token0.decimals : token1.decimals;
                  const legPrice = (
                    pricedLeg === 0 ? price0 : price1
                  ) as number;
                  // args: [sender, amount0In, amount1In, amount0Out, amount1Out, to]
                  const inIndex = pricedLeg === 0 ? 1 : 2;
                  const outIndex = pricedLeg === 0 ? 3 : 4;

                  let windowVolumeUsd = 0;
                  for (const event of swapEvents) {
                    const args = (event as any).args;
                    if (!args) continue;
                    const moved =
                      Number(ethers.formatUnits(args[inIndex], decimals)) +
                      Number(ethers.formatUnits(args[outIndex], decimals));
                    windowVolumeUsd += moved * legPrice;
                  }

                  volume24h = windowVolumeUsd * volumeWindow.scale;
                } catch (e) {
                  // Log query refused or range too wide — no volume, not zero.
                }
              }

              /* Fees come from the pair's own fee, in basis points of 10000.
               * The factory now only accepts allowlisted tiers, so a live pair
               * should always be 5, 30 or 100 — but the range is still checked
               * rather than trusted, because this hook reads whatever factory
               * address it is pointed at and a fee at or above the denominator
               * would silently turn `fees24h` into a number larger than the
               * volume that produced it. */
              const feeBps = swapFeeRaw === null ? null : Number(swapFeeRaw);
              const feeUsable =
                feeBps !== null &&
                Number.isFinite(feeBps) &&
                feeBps >= 0 &&
                feeBps < FEE_DENOMINATOR;

              if (volume24h !== null && feeUsable) {
                fees24h = volume24h * ((feeBps as number) / FEE_DENOMINATOR);
              }
              if (
                fees24h !== null &&
                liquidityUsd !== null &&
                liquidityUsd > 0
              ) {
                apr = ((fees24h * 365) / liquidityUsd) * 100;
              }

              return {
                address: pairAddress,
                token0,
                token1,
                reserves: {
                  reserve0: reserve0.toString(),
                  reserve1: reserve1.toString(),
                },
                price,
                totalSupply: totalSupply.toString(),
                volume24h: round2(volume24h),
                volumeWindowSec: volumeWindow ? volumeWindow.spanSec : null,
                liquidity: round2(liquidityUsd),
                value0: round2(value0),
                value1: round2(value1),
                fees24h: round2(fees24h),
                apr: round2(apr),
                feeBps: feeUsable ? feeBps : null,
              } satisfies ITradingPair;
            } catch (pairError) {
              console.error(
                `Error fetching data for pair ${pairAddress}:`,
                pairError,
              );
              return null;
            }
          }),
        );

        const validPools = poolsData.filter(
          (p): p is ITradingPair => p !== null,
        );
        cachedPools = validPools;
        lastFetchTime = Date.now();
        return validPools;
      })();

      const finalPools = await activeFetchPromise;
      setPools(finalPools);
    } catch (err: any) {
      console.error("Error fetching pools:", err);
      setError(err.message || "Failed to fetch pools");
    } finally {
      activeFetchPromise = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPools();

    const interval = setInterval(() => {
      fetchPools(true); // Force refetch on interval
    }, CACHE_DURATION);

    return () => clearInterval(interval);
  }, [fetchPools]);

  return {
    pools,
    loading,
    error,
    refetch: () => fetchPools(true),
  };
};
