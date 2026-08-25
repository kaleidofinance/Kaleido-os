"use client";

/**
 * One pair's recent swaps, mints and burns.
 *
 * Read from the pair's own logs over the same 5000-block ceiling `usePoolData`
 * samples volume across — the ceiling is not a preference, it is the widest
 * range most public RPC nodes will answer an `eth_getLogs` for at all.
 *
 * WHAT THIS IS NOT
 *
 * Not a history. A window of recent blocks is all a node will serve without an
 * indexer, so an empty result means "nothing in the last N blocks" and never
 * "this pool has never traded". The two read identically in a table headed
 * *Transactions* with nothing under it, which is why the window's size travels
 * back with the rows and the empty state has to name it.
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

import { readOnlyProvider } from "@/config/provider";
import type { ITradingPair } from "@/constants/types/dex";
import { MOCK_DATA, mockPoolTxns } from "@/lib/mock";

const PAIR_ABI = [
  "event Mint(address indexed sender, uint amount0, uint amount1)",
  "event Burn(address indexed sender, uint amount0, uint amount1, address indexed to)",
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
];

/** Matches `usePoolData`'s VOLUME_WINDOW_BLOCKS — the same node limit applies. */
const WINDOW_BLOCKS = 5000;

/**
 * Rows kept, newest first.
 *
 * Bounded by the timestamp cost rather than the layout: each distinct block in
 * the kept set needs its own `getBlock`, since a log carries a block number but
 * not a time. Twenty rows is a table worth reading and at most twenty extra
 * calls, and dropping the rest is the visible tradeoff `hasMore` reports.
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
  /** Blocks actually scanned — under WINDOW_BLOCKS on a chain younger than it. */
  scannedBlocks: number | null;
  /** Whether the window held more than MAX_ROWS, so the list is truncated. */
  hasMore: boolean;
}

/** `event.args` exists only on a log the ABI could decode. */
const decoded = (ev: ethers.Log | ethers.EventLog): ev is ethers.EventLog =>
  "args" in ev && ev.args !== undefined;

const units = (raw: bigint, decimals: number) =>
  Number(ethers.formatUnits(raw, decimals));

export function usePoolTransactions(pair: ITradingPair | null): PoolTxnsResult {
  const [txns, setTxns] = useState<PoolTxn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedBlocks, setScannedBlocks] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);

  /* Primitives, not the pair object. `usePoolData` refetches every 30s and hands
     back new objects each time, so depending on the object would re-scan the
     logs on a refresh that changed nothing this hook reads. */
  const address = pair?.address ?? null;
  const decimals0 = pair?.token0.decimals ?? null;
  const decimals1 = pair?.token1.decimals ?? null;

  const fetchTxns = useCallback(async () => {
    if (!address || decimals0 === null || decimals1 === null) return;

    /* Demo mode, first statement — no provider is constructed and no log query
       is issued. See src/lib/mock. */
    if (MOCK_DATA) {
      const rows = mockPoolTxns(address);
      setTxns(rows);
      setScannedBlocks(WINDOW_BLOCKS);
      setHasMore(false);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const provider = readOnlyProvider;
      const head = await provider.getBlockNumber();
      const fromBlock = Math.max(0, head - WINDOW_BLOCKS);
      setScannedBlocks(head - fromBlock);

      const contract = new ethers.Contract(address, PAIR_ABI, provider);

      /* Three queries rather than one topic-OR filter: ethers builds an OR over
         topic0 only from an explicit array of topic hashes, and naming the three
         event fragments keeps the decode typed. They run together, so it is one
         round trip's latency. */
      const [swaps, mints, burns] = await Promise.all([
        contract.queryFilter(contract.filters.Swap(), fromBlock, head),
        contract.queryFilter(contract.filters.Mint(), fromBlock, head),
        contract.queryFilter(contract.filters.Burn(), fromBlock, head),
      ]);

      const rows: PoolTxn[] = [];

      for (const ev of swaps) {
        if (!decoded(ev)) continue;
        const [, amount0In, amount1In, amount0Out, amount1Out] = ev.args;
        /* A swap moves each leg one way only, so exactly one of the two amounts
           per leg is non-zero and adding them is the leg's size rather than a
           net. `usePoolData` prices volume the same way. */
        rows.push({
          hash: ev.transactionHash,
          kind: "swap",
          blockNumber: ev.blockNumber,
          logIndex: ev.index,
          at: null,
          amount0: units(amount0In + amount0Out, decimals0),
          amount1: units(amount1In + amount1Out, decimals1),
          soldToken0: (amount0In as bigint) > 0n,
        });
      }

      for (const [list, kind] of [
        [mints, "add"],
        [burns, "remove"],
      ] as const) {
        for (const ev of list) {
          if (!decoded(ev)) continue;
          const [, amount0, amount1] = ev.args;
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

      /* Newest first, and within a block the later log first — a router call that
         mints and then syncs belongs in the order the chain executed it. */
      rows.sort(
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
      /* A node refusing the range, or an address that is not a pair. Reported
         rather than swallowed, because "no rows" and "the query failed" are
         different answers and only one of them means the pool is quiet. */
      setError(
        err instanceof Error ? err.message : "Could not read pool transactions",
      );
    } finally {
      setLoading(false);
    }
  }, [address, decimals0, decimals1]);

  useEffect(() => {
    /* Reset before refetching so a previous pool's rows never appear under a new
       pool's header while the second scan is in flight. */
    setTxns([]);
    setScannedBlocks(null);
    setHasMore(false);
    fetchTxns();
  }, [fetchTxns]);

  return { txns, loading, error, scannedBlocks, hasMore };
}
