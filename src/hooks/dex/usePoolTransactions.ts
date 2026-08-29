"use client";

/**
 * One pool's recent swaps, mints and burns — V2 pairs and V3 pools alike.
 *
 * TWO THINGS WERE WRONG HERE, AND THEY COMPOUND
 *
 * The window was a flat 5000 blocks, and the read chain refuses it. Measured on
 * 2026-08-28, thirdweb's Sepolia endpoint caps `eth_getLogs` at 1000 blocks and
 * rejects 1001 outright — so this table did not show a short slice of history on
 * the read chain, it showed an error, on every pool. Where the range *is* served,
 * a block count is still not a time window: 1000 blocks is 3.3h on Sepolia at 12s
 * and 10,000 blocks is 5.5h on Base Sepolia at 2s. It now asks the node how wide
 * a range it will answer, then walks backwards in chunks that size until it has
 * covered a comparable *span* on any chain — both of which are `@/lib/dex/logWindow`
 * — and reports the seconds it actually covered so the empty state can name them.
 *
 * The ABI was V2's only. A V3 pool's `Swap` carries two signed `int256` amounts
 * rather than four unsigned ones, and its `Mint`/`Burn` are indexed by tick
 * range — so every V3 log fell out of the decode and a V3 pool rendered as a pool
 * that had never traded. Both shapes are now declared and picked by
 * `pair.version`, which is why that field is required on `ITradingPair`.
 *
 * AND THE PROVIDER WAS THE READ CHAIN'S, WHICHEVER CHAIN THE POOL WAS ON
 *
 * A third, once the pool tables started listing every deployment: the logs were
 * always read through `readOnlyProvider`. A Base pool queried on Sepolia is a
 * query against an address that holds no pool there, so it returns no logs and no
 * error — the exact "this pool has never traded" misreading the paragraph above is
 * about, except unfixable by widening anything. The provider is now resolved from
 * `pair.chainId`, which is why that field is required too.
 *
 * WHAT THIS IS STILL NOT
 *
 * A history. Even widened, a window of recent blocks is all a node will serve
 * without an indexer, so an empty result means "nothing in the last N hours" and
 * never "this pool has never traded". The two read identically in a table headed
 * *Transactions* with nothing under it, which is why the window's size travels
 * back with the rows and the empty state has to name it.
 *
 * WHAT THE WIDER WINDOW COSTS, AND WHO PAYS IT
 *
 * Nothing, for a pool with activity: chunks run newest-first and the scan stops
 * as soon as it has `MAX_ROWS`, so a busy pool finishes in the first chunk for
 * exactly what one fixed window used to cost. Only a quiet pool pays for more
 * chunks — and a quiet pool on a fast chain is precisely the case that used to
 * render a misleadingly empty table.
 *
 * NO MODULE-SCOPE CACHE, UNLIKE `usePoolData`
 *
 * That hook caches across consumers because the whole table shares one fetch.
 * Here the fetch is per pool and one pool renders at a time, so a cache would
 * buy almost nothing — and it would cost something real: a `"use client"`
 * module is still evaluated on the server during SSR, so a populated cache
 * could render rows in the server pass, and a row carries a relative timestamp
 * measured against a clock that differs between the two passes. Fetching from
 * `useEffect` keeps the server's state empty, which keeps every timestamp a
 * browser-side measurement.
 */

import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";

import { providerForChain } from "@/config/provider";
import type { ITradingPair } from "@/constants/types/dex";
import { scanBackwards, TX_WINDOW_TARGET_SEC } from "@/lib/dex/logWindow";
import { MOCK_DATA, mockPoolTxns } from "@/lib/mock";

const V2_ABI = [
  "event Mint(address indexed sender, uint amount0, uint amount1)",
  "event Burn(address indexed sender, uint amount0, uint amount1, address indexed to)",
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
];

/** Verbatim from `IKaleidoSwapV3PoolEvents.sol` — indexed positions included,
    because they decide which `args` index each amount lands on. */
const V3_ABI = [
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  "event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
];

/**
 * Rows kept, newest first.
 *
 * Bounded by the timestamp cost rather than the layout: each distinct block in
 * the kept set needs its own `getBlock`, since a log carries a block number but
 * not a time. Twenty rows is a table worth reading and at most twenty extra
 * calls, and dropping the rest is the visible tradeoff `hasMore` reports. It is
 * also the scan's stopping condition — see the header.
 */
const MAX_ROWS = 20;

export type PoolTxnKind = "swap" | "add" | "remove";

export interface PoolTxn {
  hash: string;
  kind: PoolTxnKind;
  blockNumber: number;
  /** Position within the block. Orders two events of one transaction. */
  logIndex: number;
  /** Unix milliseconds, null when the block could not be read. */
  at: number | null;
  /** Display units, always positive — `kind` and `soldToken0` carry direction. */
  amount0: number;
  amount1: number;
  /** Swaps only: true when the sender sold token0. Null for add and remove. */
  soldToken0: boolean | null;
}

export interface PoolTxnsResult {
  txns: PoolTxn[];
  loading: boolean;
  error: string | null;
  /** Blocks actually scanned. Under the target on a chain younger than it. */
  scannedBlocks: number | null;
  /**
   * Seconds those blocks actually covered, measured from their timestamps.
   *
   * This is the figure a reader can act on, and the reason the hook was changed:
   * "no transactions in 5000 blocks" means something different on every chain,
   * "no transactions in 16 hours" does not. Null when a block read failed.
   */
  scannedSec: number | null;
  /** Whether the window held more than MAX_ROWS, so the list is truncated. */
  hasMore: boolean;
}

/** `event.args` exists only on a log the ABI could decode. */
const decoded = (ev: ethers.Log | ethers.EventLog): ev is ethers.EventLog =>
  "args" in ev && ev.args !== undefined;

const units = (raw: bigint, decimals: number) =>
  Number(ethers.formatUnits(raw, decimals));

const abs = (v: bigint) => (v < 0n ? -v : v);

/**
 * Where each venue keeps its amounts.
 *
 * Positional rather than by name, because that is what `args` is once the
 * indexed parameters have been folded in — and it is exactly where the two
 * venues differ. V3's `Mint` has four parameters before its amounts and its
 * `Burn` has three, so a single extractor for both would be silently wrong on
 * one of them.
 */
interface EventShape {
  abi: string[];
  swap: (args: ethers.Result) => {
    amount0: bigint;
    amount1: bigint;
    soldToken0: boolean;
  };
  mint: (args: ethers.Result) => [bigint, bigint];
  burn: (args: ethers.Result) => [bigint, bigint];
}

const SHAPES: Record<ITradingPair["version"], EventShape> = {
  v2: {
    abi: V2_ABI,
    /* [sender, amount0In, amount1In, amount0Out, amount1Out, to]. A swap moves
       each leg one way only, so exactly one of the two amounts per leg is
       non-zero and adding them is the leg's size rather than a net.
       `usePoolData` prices volume the same way. */
    swap: (a) => ({
      amount0: (a[1] as bigint) + (a[3] as bigint),
      amount1: (a[2] as bigint) + (a[4] as bigint),
      soldToken0: (a[1] as bigint) > 0n,
    }),
    /** [sender, amount0, amount1] and [sender, amount0, amount1, to]. */
    mint: (a) => [a[1] as bigint, a[2] as bigint],
    burn: (a) => [a[1] as bigint, a[2] as bigint],
  },
  v3: {
    abi: V3_ABI,
    /* [sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick].
       Signed from the pool's side — positive is what came in — so the magnitude
       is the leg's size and the sign is the direction. A positive token0 means
       the trader handed token0 over, which is what `soldToken0` means. */
    swap: (a) => ({
      amount0: abs(a[2] as bigint),
      amount1: abs(a[3] as bigint),
      soldToken0: (a[2] as bigint) > 0n,
    }),
    /** [sender, owner, tickLower, tickUpper, amount, amount0, amount1]. */
    mint: (a) => [a[5] as bigint, a[6] as bigint],
    /** [owner, tickLower, tickUpper, amount, amount0, amount1] — one shorter. */
    burn: (a) => [a[4] as bigint, a[5] as bigint],
  },
};

export function usePoolTransactions(pair: ITradingPair | null): PoolTxnsResult {
  const [txns, setTxns] = useState<PoolTxn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedBlocks, setScannedBlocks] = useState<number | null>(null);
  const [scannedSec, setScannedSec] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);

  /* Primitives, not the pair object. `usePoolData` refetches every 30s and hands
     back new objects each time, so depending on the object would re-scan the
     logs on a refresh that changed nothing this hook reads. */
  const address = pair?.address ?? null;
  const version = pair?.version ?? null;
  const chainId = pair?.chainId ?? null;
  const decimals0 = pair?.token0.decimals ?? null;
  const decimals1 = pair?.token1.decimals ?? null;

  const fetchTxns = useCallback(async () => {
    if (
      !address ||
      !version ||
      chainId === null ||
      decimals0 === null ||
      decimals1 === null
    )
      return;

    /* Demo mode, first statement — no provider is constructed and no log query
       is issued. It reports the span a real scan aims for and no block count,
       which is honest on both counts: a fixture covers no blocks, and the empty
       state prefers the span anyway because that is the figure a reader can act
       on. So a fixture-less address reads the same here as on chain rather than
       as "not read". See src/lib/mock. */
    if (MOCK_DATA) {
      const rows = mockPoolTxns(address);
      setTxns(rows);
      setScannedBlocks(null);
      setScannedSec(TX_WINDOW_TARGET_SEC);
      setHasMore(false);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      /* The pool's own chain, not the read chain. A null provider means
         `chains.ts` carries no RPC URL for the chain this pool was enumerated
         from, which cannot happen for a pool that came from `discoveryChains()`
         — and if it ever does, saying so beats reading some other chain and
         presenting the answer as this pool's history. */
      const provider = providerForChain(chainId);
      if (!provider) {
        throw new Error(`No RPC endpoint configured for chain ${chainId}`);
      }
      const shape = SHAPES[version];
      const contract = new ethers.Contract(address, shape.abi, provider);

      const scan = await scanBackwards<PoolTxn>(
        provider,
        async (fromBlock, toBlock) => {
          /* Three queries rather than one topic-OR filter: ethers builds an OR
             over topic0 only from an explicit array of topic hashes, and naming
             the three event fragments keeps the decode typed. They run together,
             so it is one round trip's latency per chunk. */
          const [swaps, mints, burns] = await Promise.all([
            contract.queryFilter(contract.filters.Swap(), fromBlock, toBlock),
            contract.queryFilter(contract.filters.Mint(), fromBlock, toBlock),
            contract.queryFilter(contract.filters.Burn(), fromBlock, toBlock),
          ]);

          const rows: PoolTxn[] = [];

          for (const ev of swaps) {
            if (!decoded(ev)) continue;
            const { amount0, amount1, soldToken0 } = shape.swap(ev.args);
            rows.push({
              hash: ev.transactionHash,
              kind: "swap",
              blockNumber: ev.blockNumber,
              logIndex: ev.index,
              at: null,
              amount0: units(amount0, decimals0),
              amount1: units(amount1, decimals1),
              soldToken0,
            });
          }

          for (const [list, kind, extract] of [
            [mints, "add", shape.mint],
            [burns, "remove", shape.burn],
          ] as const) {
            for (const ev of list) {
              if (!decoded(ev)) continue;
              const [amount0, amount1] = extract(ev.args);
              /* A liquidity event that moved no tokens is dropped, not rendered
                 as "Remove liquidity — 0 — 0". V3's position manager pokes a
                 position with `burn(0)` before collecting fees from it, so each
                 real withdrawal on chain is bracketed by two no-op `Burn`s with
                 liquidity, amount0 and amount1 all zero — measured on the
                 Sepolia KLD pool, where six of the window's twelve events were
                 these. Left in, they outnumber the transactions they surround
                 and push the real ones out of a table capped at MAX_ROWS. */
              if (amount0 === 0n && amount1 === 0n) continue;
              rows.push({
                hash: ev.transactionHash,
                kind,
                blockNumber: ev.blockNumber,
                logIndex: ev.index,
                at: null,
                amount0: units(amount0, decimals0),
                amount1: units(amount1, decimals1),
                soldToken0: null,
              });
            }
          }

          return rows;
        },
        /* Chunks are newest-first, so the rows already gathered are the newest
           ones and stopping here cannot drop a row that would have displaced
           one of them. */
        { enough: (rows) => rows.length >= MAX_ROWS },
      );

      setScannedBlocks(scan.blocks);
      setScannedSec(scan.seconds);

      /* Newest first, and within a block the later log first — a router call that
         mints and then syncs belongs in the order the chain executed it. */
      const rows = scan.rows.sort(
        (a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex,
      );

      setHasMore(rows.length > MAX_ROWS);
      const kept = rows.slice(0, MAX_ROWS);

      /* Timestamps for the kept rows only, one call per distinct block. A failed
         block read leaves `at` null and the row still renders: the transaction
         happened whether or not its time could be fetched. */
      const blocks = Array.from(new Set(kept.map((r) => r.blockNumber)));
      const times = new Map<number, number>();
      await Promise.all(
        blocks.map(async (n) => {
          try {
            const block = await provider.getBlock(n);
            if (block) times.set(n, block.timestamp * 1000);
          } catch {
            // Left out of the map; the row reports no time.
          }
        }),
      );

      setTxns(
        kept.map((r) => ({ ...r, at: times.get(r.blockNumber) ?? null })),
      );
    } catch (err) {
      /* A node refusing the range, or an address that is not a pool of this
         version. Reported rather than swallowed, because "no rows" and "the
         query failed" are different answers and only one of them means the pool
         is quiet. */
      setError(
        err instanceof Error ? err.message : "Could not read pool transactions",
      );
    } finally {
      setLoading(false);
    }
  }, [address, version, chainId, decimals0, decimals1]);

  useEffect(() => {
    /* Reset before refetching so a previous pool's rows never appear under a new
       pool's header while the second scan is in flight. */
    setTxns([]);
    setScannedBlocks(null);
    setScannedSec(null);
    setHasMore(false);
    fetchTxns();
  }, [fetchTxns]);

  return { txns, loading, error, scannedBlocks, scannedSec, hasMore };
}
