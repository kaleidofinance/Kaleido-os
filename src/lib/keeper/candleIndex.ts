import { ethers } from "ethers";

import { providerForChain } from "@/config/provider";
import { getContracts } from "@/constants/registry";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";
import {
  candlesFrom,
  type Candle,
  type SwapTick,
} from "@/lib/v2/prices/candles";
import {
  getCursor,
  readCandles,
  setCursor,
  upsertCandles,
} from "@/lib/v2/prices/candleStore";

/**
 * The KLD candle indexer: our own pool's Swap events into stored candles.
 *
 * Runs behind /api/keeper/candles on the same cron as the price pusher. Per
 * (chain, pool) it reads how far it got last time, scans the Swap logs since,
 * turns each swap's tick into a price with the code that
 * src/lib/v2/prices/candles.ts already tests, buckets them, and writes the
 * result. The one job here that is not in candles.ts is getting the logs, and
 * getting the logs is the hard part — it is the same span / rate-limit /
 * pruning problem the staking snapshots hit, made permanent because this runs
 * forever rather than once.
 *
 * WHY V3, AND WHY THE FACTORY RESOLVES THE POOL. The KLD markets are V3 pools,
 * so the price is Swap.tick, not a Sync reserve ratio. The pool is found by
 * asking the chain's own factory for getPool(KLD, USDC, tier) across the fee
 * tiers rather than trusting a hardcoded address — a redeployed pool changes
 * address, and an indexer pinned to a dead one would quietly stop finding
 * swaps. A chain with no KLD pool (Arc) resolves to null and is skipped, not
 * errored: nothing to index is a normal state, not a fault.
 *
 * WHERE IT STARTS. With a cursor, from the block after it. Without one — the
 * first run on a (chain, pool) — from a bounded lookback, not the pool's
 * creation: bisecting for the creation block needs historical state the public
 * endpoints prune, and the honest thing a first run does is begin the series
 * now and let it fill forward. Deep history is a separate backfill, off the
 * critical path.
 *
 * THE REORG MARGIN IS NOT OPTIONAL. A testnet reorgs, and a candle built from a
 * swap in a block that later disappears is a price that never happened. So the
 * scan stops REORG_MARGIN blocks behind the head and the cursor never passes
 * that line — the last few blocks are re-read next run, when they have settled,
 * which the open-bucket re-fold already makes idempotent.
 */

/** keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)"). */
const SWAP_TOPIC = ethers.id(
  "Swap(address,address,int256,int256,uint160,uint128,int24)",
);

const SWAP_IFACE = new ethers.Interface([
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
]);

const POOL_META_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];
const FACTORY_ABI = [
  "function getPool(address,address,uint24) view returns (address)",
];

/** The V3 fee tiers this app deploys, cheapest first. */
const FEE_TIERS = [100, 500, 3000, 10000];

/** How far behind the head to stop, so a reorg cannot orphan a stored candle. */
const REORG_MARGIN = Number(process.env.CANDLE_REORG_MARGIN ?? 5);
/** Blocks per getLogs. Per-chain overridable, same reason the snapshots are. */
const DEFAULT_SPAN = Number(process.env.CANDLE_SPAN ?? 10_000);
/** First-run window when there is no cursor yet. */
const DEFAULT_LOOKBACK = Number(process.env.CANDLE_LOOKBACK ?? 100_000);
/** Pace between calls on an endpoint that rate-limits (Arc). 0 elsewhere. */
const DELAY_MS = Number(process.env.CANDLE_DELAY_MS ?? 0);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PoolMeta {
  address: string;
  fee: number;
  kldIsToken0: boolean;
  decimals0: number;
  decimals1: number;
}

/* -------------------------------------------------------- pure, testable -- */

/**
 * The [start, end] block windows to scan `from`..`to` in, each at most `span`
 * wide. Inclusive both ends. Empty when there is nothing to scan.
 *
 * Pure and tested because an off-by-one here is a missed swap on one edge or a
 * double-read on the other, and the second is only harmless because the fold
 * dedupes — the first is a candle that silently never forms.
 */
export function planSpans(
  from: number,
  to: number,
  span: number,
): Array<{ start: number; end: number }> {
  if (to < from) return [];
  const width = Math.max(1, Math.floor(span));
  const out: Array<{ start: number; end: number }> = [];
  for (let start = from; start <= to; start += width) {
    out.push({ start, end: Math.min(start + width - 1, to) });
  }
  return out;
}

/**
 * A raw Swap log to the fields a candle needs, or null if it is not one.
 *
 * Pure given the log. Returns null rather than throwing on a log that does not
 * decode, so one malformed entry in a getLogs page cannot lose the page.
 */
export function decodeSwap(log: {
  topics: string[];
  data: string;
  blockNumber: number;
  logIndex: number;
}): { blockNumber: number; logIndex: number; tick: number } | null {
  if (log.topics[0]?.toLowerCase() !== SWAP_TOPIC.toLowerCase()) return null;
  try {
    const parsed = SWAP_IFACE.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) return null;
    const tick = Number(parsed.args.tick);
    if (!Number.isFinite(tick)) return null;
    return { blockNumber: log.blockNumber, logIndex: log.logIndex, tick };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- I/O -- */

/**
 * A rate limit is a request to wait, not a failure, so it backs off outside the
 * retry budget — the same shape the staking snapshot needed once Arc forced it.
 */
const isRateLimit = (e: unknown) =>
  /rate limit|too many requests|429/i.test(String((e as Error)?.message ?? e));

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let limited = 0;
  for (let attempt = 0; ; ) {
    try {
      if (DELAY_MS) await sleep(DELAY_MS);
      return await fn();
    } catch (e) {
      if (isRateLimit(e) && limited < 8) {
        await sleep(Math.min(1000 * 2 ** limited, 30_000));
        limited++;
        continue;
      }
      attempt++;
      if (attempt >= 4) throw e;
      await sleep(800 * attempt);
    }
  }
}

/** The KLD/USDC pool on a chain, or null when it has none. */
export async function resolveKldPool(
  chainId: number,
  provider: ethers.JsonRpcProvider,
): Promise<PoolMeta | null> {
  const { kld, usdc, v3Factory } = getContracts(chainId);
  if (!kld || !usdc || !v3Factory) return null;

  const factory = new ethers.Contract(v3Factory, FACTORY_ABI, provider);
  for (const fee of FEE_TIERS) {
    const address: string = await withRetry(() => factory.getPool(kld, usdc, fee));
    if (!address || address === ethers.ZeroAddress) continue;

    const pool = new ethers.Contract(address, POOL_META_ABI, provider);
    const token0: string = await withRetry(() => pool.token0());
    const kldIsToken0 = token0.toLowerCase() === kld.toLowerCase();
    const decimals0 = getTokenDecimals(chainId, token0);
    const token1: string = kldIsToken0 ? usdc : kld;
    const decimals1 = getTokenDecimals(chainId, token1);
    return { address: address.toLowerCase(), fee, kldIsToken0, decimals0, decimals1 };
  }
  return null;
}

export interface IndexResult {
  chainId: number;
  pool: string | null;
  fromBlock: number;
  toBlock: number;
  swaps: number;
  candles: number;
  wrote: boolean;
  error: string | null;
}

/**
 * Index one chain's KLD pool up to the reorg-safe head.
 *
 * Reads the cursor, scans Swap logs in spans, folds them into 15m candles with
 * the tested candle code, and upserts. `dryRun` does every read and no write.
 */
export async function indexChain(
  chainId: number,
  opts: { dryRun?: boolean; span?: number; lookback?: number } = {},
): Promise<IndexResult> {
  const base: IndexResult = {
    chainId,
    pool: null,
    fromBlock: 0,
    toBlock: 0,
    swaps: 0,
    candles: 0,
    wrote: false,
    error: null,
  };

  const provider = providerForChain(chainId);
  if (!provider) return { ...base, error: "no provider for chain" };

  let pool: PoolMeta | null;
  try {
    pool = await resolveKldPool(chainId, provider);
  } catch (e) {
    return { ...base, error: `pool resolve failed: ${(e as Error).message}` };
  }
  if (!pool) return { ...base, error: null }; // no KLD pool here — not a fault

  try {
    const head = (await withRetry(() => provider.getBlockNumber())) - REORG_MARGIN;
    const span = opts.span ?? DEFAULT_SPAN;
    const lookback = opts.lookback ?? DEFAULT_LOOKBACK;

    const cursor = await getCursor(chainId, pool.address);
    const from = (cursor ?? Math.max(0, head - lookback)) + (cursor === null ? 0 : 1);
    if (head < from) {
      return { ...base, pool: pool.address, fromBlock: from, toBlock: head };
    }

    /* Collect Swap logs across the window, then the timestamps for the blocks
       they landed in — swaps are rare on these pools, so unique blocks are few
       and one getBlock each is cheap. */
    const raw: Array<{ blockNumber: number; logIndex: number; tick: number }> = [];
    for (const { start, end } of planSpans(from, head, span)) {
      const logs = await withRetry(() =>
        provider.getLogs({
          address: pool!.address,
          topics: [SWAP_TOPIC],
          fromBlock: start,
          toBlock: end,
        }),
      );
      for (const log of logs) {
        const d = decodeSwap({
          topics: log.topics as unknown as string[],
          data: log.data,
          blockNumber: log.blockNumber,
          logIndex: log.index,
        });
        if (d) raw.push(d);
      }
    }

    const blockTimes = new Map<number, number>();
    for (const bn of new Set(raw.map((r) => r.blockNumber))) {
      const block = await withRetry(() => provider.getBlock(bn));
      if (block) blockTimes.set(bn, Number(block.timestamp));
    }

    const swaps: SwapTick[] = raw
      .filter((r) => blockTimes.has(r.blockNumber))
      .map((r) => ({
        blockNumber: r.blockNumber,
        logIndex: r.logIndex,
        timestamp: blockTimes.get(r.blockNumber)!,
        tick: r.tick,
      }));

    const shape = {
      kldIsToken0: pool.kldIsToken0,
      decimals0: pool.decimals0,
      decimals1: pool.decimals1,
      fee: pool.fee,
    };
    const fresh = candlesFrom(swaps, "15m", shape);

    if (opts.dryRun) {
      return {
        ...base,
        pool: pool.address,
        fromBlock: from,
        toBlock: head,
        swaps: swaps.length,
        candles: fresh.length,
        wrote: false,
      };
    }

    if (fresh.length > 0) {
      const { error } = await upsertCandles(chainId, pool.address, fresh);
      if (error) return { ...base, pool: pool.address, fromBlock: from, toBlock: head, error };
    }
    /* Advance the cursor even when nothing traded: the empty range is scanned,
       and re-scanning it forever is the one thing the cursor exists to prevent. */
    const { error: cErr } = await setCursor(chainId, pool.address, head);

    return {
      ...base,
      pool: pool.address,
      fromBlock: from,
      toBlock: head,
      swaps: swaps.length,
      candles: fresh.length,
      wrote: fresh.length > 0,
      error: cErr,
    };
  } catch (e) {
    return { ...base, pool: pool.address, error: (e as Error).message };
  }
}

/** Index several chains, each independent — one chain's failure is its own. */
export async function indexChains(
  chainIds: number[],
  opts: { dryRun?: boolean } = {},
): Promise<IndexResult[]> {
  const out: IndexResult[] = [];
  for (const id of chainIds) out.push(await indexChain(id, opts));
  return out;
}

/** Re-exported for the price route, so it and the indexer read one store. */
export { readCandles };
