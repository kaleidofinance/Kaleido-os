"use client";

/**
 * KaleidoSwap V2 pairs, read without a wallet, on every chain we deployed to.
 *
 * This hook produced the Pools table's numbers, and most of them were invented:
 *
 *  - It returned `[]` unless `window.ethereum` existed, so the public all-pools
 *    table — then on /explore, now on /pool — showed "No pools indexed yet" to
 *    every visitor who had no injected wallet. It now reads through its own
 *    providers unconditionally, which also fixes a wrong-chain bug: a factory
 *    lives at one address per chain, so reading it through a wallet connected to
 *    some other chain queried whatever happens to sit at that address there.
 *  - 24h volume was the 5000-block window's volume times `17.28`. That constant
 *    is 86400/5000, i.e. an assumption that blocks are exactly one second apart.
 *    The window's real duration is now read from the two block timestamps — and
 *    its *width* is asked of the node rather than assumed, because the read
 *    chain's endpoint refuses 5000 outright. See `@/lib/dex/logWindow`.
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
 *
 * EVERY DEPLOYED CHAIN, NOT THE READ CHAIN ALONE
 *
 * It also read one chain — `READ_ONLY_CHAIN_ID` — which was right to refuse the
 * *wallet's* chain and wrong to stop there: `allPairsLength()` is zero on the read
 * chain today, so a table headed "All pools" showed nothing while pairs existed
 * elsewhere. The enumeration now runs once per chain over `discoveryChains()`, and
 * `@/lib/dex/poolDiscovery` holds the fan-out: rows publish per chain as they land,
 * a chain that fails contributes nothing rather than failing the list, and each
 * chain gets a deadline. Every pair stamps `ITradingPair.chainId` with the chain it
 * came from, which is what the row's chain tag and the detail page's log reads use.
 *
 * V2 ONLY, AND DELIBERATELY SO
 *
 * V3 pools are enumerated by `useV3Pools`, a sibling hook, and the two are merged
 * by the pages that show both. One hook reading both venues was the alternative
 * and it is worse: nothing here is shared beyond the price table, the volume
 * window and the chain fan-out — which is exactly why those three live in
 * `@/lib/market/spot`, `@/lib/dex/logWindow` and `@/lib/dex/poolDiscovery` — while
 * `allPairs(i)`, `getReserves()` and `swapFee()` have no V3 counterpart at all.
 * Both hooks emit `ITradingPair` with `version` set, so a consumer branches on one
 * field rather than on which hook it came from.
 */

import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContracts } from "@/constants/registry";
import { ITradingPair } from "@/constants/types/dex";
import { chainTokenByAddress } from "@/constants/tokens";
import { readVolumeWindow } from "@/lib/dex/logWindow";
import {
  createPoolStore,
  type DiscoveryChain,
} from "@/lib/dex/poolDiscovery";
import { retryRpc } from "@/lib/dex/rpcRetry";
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

const CACHE_DURATION = 30_000; // 30 seconds

/* One cache for every consumer, keyed by chain inside so a chain's pairs can
 * land while another chain is still being read. Same contract as useV3Pools':
 * the strip, the table and the detail page are views of one fetch and must not
 * disagree — see createPoolStore. */
const store = createPoolStore(CACHE_DURATION);

/** `swapFee()`'s denominator — KaleidoSwapPair.sol:243. */
const FEE_DENOMINATOR = 10_000;

const round2 = (n: number | null) =>
  n === null || !Number.isFinite(n) ? null : Number(n.toFixed(2));

/** ERC20 metadata for a token the registry does not carry on this chain. */
async function readTokenMetadata(
  address: string,
  provider: ethers.Provider,
  chainId: number,
) {
  const contract = new ethers.Contract(address, ERC20_ABI, provider);
  const [symbol, name, decimals] = await retryRpc(() =>
    Promise.all([contract.symbol(), contract.name(), contract.decimals()]),
  );
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

/**
 * Every V2 pair one chain's factory has created.
 *
 * One chain's whole share of the sweep, so five of these can run independently
 * and whichever finishes first can be published. A chain with no V2 factory
 * recorded, or a factory with no pairs, returns before reading anything else.
 */
async function sweepChain(
  chain: DiscoveryChain,
  priceOf: PriceLookup,
): Promise<ITradingPair[]> {
  const { chainId, provider } = chain;

  /* This chain's own factory and its own provider. Not the wallet's: a discovery
   * page should show the same pools to a visitor as to a connected user, so which
   * chains it reads is configuration rather than a choice the wallet gets to make
   * — and reading a factory address through a wallet on some other chain would
   * query whatever code happens to sit there. */
  const v2Factory = getContracts(chainId).v2Factory;
  if (!v2Factory) return [];

  const factory = new ethers.Contract(v2Factory, FACTORY_ABI, provider);
  /* Retried while the refusal looks like throttling, because these two reads are
   * the whole chain: `allPairsLength()` refused reads as a factory with no pairs,
   * and one refused `allPairs(i)` loses a pair with no trace. Two of five endpoints
   * throttle under the five-chain sweep — see `rpcRetry.ts` for the measurement. */
  const pairsCount = Number(await retryRpc(() => factory.allPairsLength()));
  if (pairsCount === 0) return [];

  // Parallelize address fetching (10x Speedup)
  const pairAddresses: string[] = await retryRpc(() =>
    Promise.all(Array.from({ length: pairsCount }, (_, i) => factory.allPairs(i))),
  );

  /* The window is context for every pair on this chain, so it is read once — and
   * per chain rather than once overall, because a block count is a different span
   * on each. A chain whose node will not give one up still lists its pairs, with
   * no volume rather than no pairs: volume is one nullable column, the pairs are
   * the page. Prices come from the sweep's own prepare step, since a symbol's
   * price is not chain-specific. */
  const volumeWindow = await readVolumeWindow(provider).catch(() => null);

  /* Annotated rather than inferred. Without it TypeScript widens the
     returned object to its own literal shape — `version: "v2"` included —
     and the `p is ITradingPair` narrowing below then fails, because a type
     whose `version` is the union is not assignable to one whose `version`
     is the single literal this hook always sets. */
  const poolsData = await Promise.all(
    pairAddresses.map(async (pairAddress): Promise<ITradingPair | null> => {
      try {
        const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);

        // Fetch basic pair info in parallel
        const [
          token0Address,
          token1Address,
          reserves,
          totalSupply,
          swapFeeRaw,
        ] = await retryRpc(() =>
          Promise.all([
            pair.token0(),
            pair.token1(),
            pair.getReserves(),
            pair.totalSupply(),
            pair.swapFee().catch(() => null),
          ]),
        );

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
          chainId,
          version: "v2",
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

  return poolsData.filter((p): p is ITradingPair => p !== null);
}

export const usePoolData = () => {
  const [pools, setPools] = useState<ITradingPair[]>(() => store.snapshot());
  const [loading, setLoading] = useState(store.snapshot().length === 0);
  const [error, setError] = useState<string | null>(null);

  /* Subscribed while mounted, not only while this consumer's own sweep runs: one
     sweep serves the strip, the table and the detail page, and it publishes chain
     by chain. */
  useEffect(() => store.subscribe(setPools), []);

  const fetchPools = useCallback(async (force = false) => {
    /*
     * Demo mode. First statement in the fetch, so no provider is ever used and
     * the shared store stays empty — the initial state is still `[]`, which keeps
     * the fixtures out of the server-rendered pass. Every figure below is
     * arithmetically consistent with its own reserves; see src/lib/mock.
     * Delete this block with that directory.
     */
    if (MOCK_DATA) {
      setPools(MOCK_POOLS);
      setError(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      /* Prices once for the whole sweep, then one enumeration per chain. A null
         price map is not fatal: each figure that needed a price reports null and
         the table renders an em dash. */
      setPools(
        await store.sweep(
          async () => priceLookup(await fetchSpotPrices()),
          (chain, priceOf) => sweepChain(chain, priceOf),
          force,
        ),
      );
    } catch (err: any) {
      /* Only reached when every chain failed — see PoolStore.sweep. One dead
         endpoint is logged there and leaves the other chains' rows on screen. */
      console.error("Error fetching pools:", err);
      setError(err.message || "Failed to fetch pools");
    } finally {
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
