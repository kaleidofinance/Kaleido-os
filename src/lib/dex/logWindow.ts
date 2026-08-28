import { ethers } from "ethers";

/**
 * The block ranges this app reads logs over, and how long they really lasted.
 *
 * Three hooks sample a pool's own logs — `usePoolData` for V2 volume,
 * `useV3Pools` for V3 volume, `usePoolTransactions` for the rows under a pool —
 * and all three used to carry their own copy of the window. That is fine while
 * there is one enumerator, and stops being fine the moment two of them feed the
 * same table: a V2 row scaled off one window sitting beside a V3 row scaled off
 * another is two different measurements presented as one column. So the two
 * volume readers share the sampled window itself and not merely the code that
 * builds it — see `readVolumeWindow`.
 *
 * THE RANGE WAS A GUESS, AND THE READ CHAIN REFUSES IT
 *
 * This module used to export a flat `CHUNK_BLOCKS = 5000`, described as "the
 * widest range most public RPCs will answer". Measured against the endpoints
 * chains.ts actually dials, on 2026-08-28:
 *
 *   - Sepolia via `11155111.rpc.thirdweb.com` — **1000 blocks**, and 1024 is
 *     already refused with `-32005 Log response size exceeded. Maximum allowed
 *     number of requested blocks is 1000`;
 *   - Base Sepolia via `sepolia.base.org` — 10,000 blocks, refused at 50,000
 *     with `-32614 eth_getLogs is limited to a 10,000 range`.
 *
 * So every log query this app made against the read chain was rejected outright.
 * Volume came back null and the transactions table came back as an error, which
 * is why a pool that had definitely traded rendered as one that never had. The
 * ceiling is now *measured* per provider instead of asserted — see `chunkBlocks`.
 *
 * WHY A BLOCK COUNT IS NOT A TIME WINDOW EITHER
 *
 * Even a range the node accepts is a wildly different amount of *time* per chain:
 * 1000 blocks is 3.3h on Sepolia at 12s, and 10,000 blocks is 5.5h on Base
 * Sepolia at 2s. The two consumers need different things from that fact:
 *
 *  - Volume can live inside one chunk, because it is extrapolated anyway and
 *    `VolumeWindow.scale` is built from the window's *measured* seconds. A short
 *    sample scaled up is explicitly labelled as such, and `volumeTitle` in the
 *    pool section names the span in the tooltip.
 *  - A transactions list cannot. There is nothing to scale — a row either shows
 *    or it does not — so covering less time simply hides transactions. That one
 *    walks backwards in chunks until it has covered a comparable span on every
 *    chain, which is what `scanBackwards` is for.
 */

/**
 * Range the ceiling probe opens with.
 *
 * 10,000 because that is the highest any configured endpoint serves, so a node at
 * the top of the range costs one probe call and no retries. A node below it says
 * so in the error and the probe drops straight to what it named.
 */
export const MAX_CHUNK_BLOCKS = 10_000;

/**
 * Floor on the probed ceiling.
 *
 * A node that will not serve 200 blocks of logs cannot support any of this, and
 * halving past it would turn one refused query into a hundred refused ones.
 */
const MIN_CHUNK_BLOCKS = 200;

/**
 * A topic no event hashes to, so the probe measures the *range* rule alone.
 *
 * Verified necessary and sufficient: on thirdweb's Sepolia a 1024-block query
 * with this topic is refused with the same `-32005` as one with a real event
 * topic, despite matching nothing — so the rule is about block count rather than
 * response size, and probing with it costs no bandwidth and finds the same limit.
 */
const PROBE_TOPIC = `0x${"f".repeat(64)}`;

export const DAY_SEC = 86_400;

/**
 * Shortest sample worth extrapolating from.
 *
 * Scaling to a day multiplies whatever the window contains by `86400/span`, so
 * a two-minute window multiplies a single trade by 720. Below this the figure
 * carries less information than the em dash that replaces it.
 */
export const MIN_WINDOW_SEC = 600;

/**
 * Is this error the node objecting to the range, and did it name a limit?
 *
 * Three answers, and they have to stay distinct. `null` means the failure was
 * something else — a transient `-32011 no backend is currently healthy to serve
 * traffic` came back mid-measurement from Base Sepolia — and shrinking the window
 * in response to that would permanently narrow every later query because of one
 * bad second. `{ limit: n }` is the node stating its own maximum, which is worth
 * more than any guess. `{ limit: null }` is a range complaint with no number in
 * it, and the caller halves.
 *
 * A number is only trusted when the message is about blocks or a range. "query
 * returned more than 10000 results" is a *result* count, and treating 10000 as a
 * block ceiling there would keep the query failing at exactly the same width.
 */
function rangeComplaint(err: unknown): { limit: number | null } | null {
  /* The JSON-RPC message, not ethers' wrapper. `err.message` on a
     CALL_EXCEPTION-style error embeds the whole request payload, block numbers
     included, and picking the largest integer out of that would read a block
     height as a range limit. */
  const inner = (err as { error?: { message?: unknown } } | null)?.error;
  const raw = typeof inner?.message === "string" ? inner.message : "";
  const message = raw || (err instanceof Error ? err.message : "");
  if (!message) return null;

  if (
    !/\b(?:block\s*range|range|requested blocks|too many blocks|log response size|block span|exceeds? the (?:maximum|limit))/i.test(
      message,
    )
  ) {
    return null;
  }

  /* Largest integer in the message, commas stripped: "Maximum allowed number of
     requested blocks is 1000" gives 1000, "limited to a 10,000 range" gives
     10000. Only read when the message talks about blocks or a range — see above. */
  const aboutBlocks = /block|range/i.test(message);
  if (!aboutBlocks) return { limit: null };

  const numbers = [...message.matchAll(/\d[\d,]*/g)]
    .map((m) => Number(m[0].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  const limit = numbers.length > 0 ? Math.max(...numbers) : null;
  return { limit };
}

/* Cached per provider rather than per chain id, so no network call is needed to
   key it and an overridden `NEXT_PUBLIC_HTTP_RPC` gets its own measurement
   instead of inheriting the default endpoint's. A promise, not a number, so
   concurrent first callers share one probe — `usePoolData` and `useV3Pools` mount
   together and would otherwise probe twice. */
const ceilings = new WeakMap<ethers.Provider, Promise<number>>();

/**
 * The widest `eth_getLogs` range this provider's node will actually answer.
 *
 * Probed once and cached for the life of the provider — `readOnlyProvider` is a
 * module singleton, so that is once per page load, for one or two `eth_getLogs`
 * calls that match nothing.
 *
 * Deliberately probed rather than learned from the first real failure. The
 * failure path was the original bug: a refused query is caught by its caller and
 * reported as "no volume", so the app would have shown an empty first paint on
 * every cold load and only corrected itself on the next 30s refresh.
 */
export function chunkBlocks(provider: ethers.Provider): Promise<number> {
  const cached = ceilings.get(provider);
  if (cached) return cached;

  const probe = (async () => {
    let span = MAX_CHUNK_BLOCKS;
    try {
      const head = await provider.getBlockNumber();
      span = Math.min(span, head + 1);

      /* Four attempts covers 10,000 → 200 by halving, and a node that names its
         own limit is done in two. */
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await provider.getLogs({
            fromBlock: head - span + 1,
            toBlock: head,
            topics: [PROBE_TOPIC],
          });
          return span;
        } catch (err) {
          const complaint = rangeComplaint(err);
          /* Not a range rule. Stop probing and keep the span: the node is
             unwell, not narrow, and the caller's own error handling is the right
             place for that. */
          if (!complaint) return span;

          const named = complaint.limit;
          const next =
            named !== null && named >= MIN_CHUNK_BLOCKS && named < span
              ? named
              : Math.floor(span / 2);
          if (next < MIN_CHUNK_BLOCKS) return MIN_CHUNK_BLOCKS;
          span = next;
        }
      }
      return span;
    } catch {
      /* Could not even read the head. Nothing measured, so leave the optimistic
         value — a wrong ceiling is recoverable, a hook that never resolves is
         not. */
      return span;
    }
  })();

  ceilings.set(provider, probe);
  return probe;
}

export interface VolumeWindow {
  fromBlock: number;
  toBlock: number;
  /** Real seconds between the two blocks, from their own timestamps. */
  spanSec: number;
  /** Multiplier onto a day. Below 1 when the sample already spans longer. */
  scale: number;
}

/**
 * How long one sampled window is handed out for.
 *
 * Matched to the enumerators' own 30s cache so a window never outlives the pool
 * figures computed against it, and short enough that the head it names is never
 * meaningfully behind the chain. The promise is memoised rather than the value,
 * so two hooks mounting in the same tick share one in-flight read.
 */
const WINDOW_TTL_MS = 30_000;

const windows = new WeakMap<
  ethers.Provider,
  { at: number; window: Promise<VolumeWindow | null> }
>();

/**
 * The block range volume is sampled over, and how long it really lasted.
 *
 * Fetched once per refresh and shared by every pool, so the two extra block
 * reads cost nothing per pool. Returns null when the range is unusable — a
 * chain younger than the window, a node reporting non-monotonic timestamps, or
 * a span too short to extrapolate from — and the caller reports no volume at
 * all rather than a scaled guess.
 *
 * SHARED BETWEEN THE TWO ENUMERATORS, INSTANCE AND ALL
 *
 * Memoised for `WINDOW_TTL_MS` per provider, because `usePoolData` and
 * `useV3Pools` mount together and each asks for a window. Sharing the *code*
 * would already give both the same width and the same arithmetic; sharing the
 * *instance* gives them the same head block, so a V2 row and a V3 row sitting in
 * one 24h-volume column are extrapolated from exactly the same span rather than
 * from two samples a block or two apart. It also halves the block reads.
 *
 * ONE CHUNK, WHICH ON THE READ CHAIN IS NOW 3.3h RATHER THAN A REFUSAL
 *
 * Sized to the probed ceiling, so on Sepolia this samples 1000 blocks and scales
 * by ~7.2 instead of asking for 5000 and being refused. A 3.3h sample extrapolated
 * to a day is a real measurement with a stated span, and the em dash it replaces
 * was not. Widening it would mean a chunked read *per pool* — 28 pools × 5 chunks
 * on the read chain — for a figure the tooltip already qualifies, which is why
 * only the transactions scan chunks.
 */
export function readVolumeWindow(
  provider: ethers.Provider,
): Promise<VolumeWindow | null> {
  const memo = windows.get(provider);
  if (memo && Date.now() - memo.at < WINDOW_TTL_MS) return memo.window;

  const window = computeVolumeWindow(provider);
  const entry = { at: Date.now(), window };
  windows.set(provider, entry);

  /* A failed read is not memoised. `computeVolumeWindow` returns null for the
     failures it recognises, so reaching here means the provider itself threw —
     and holding that rejection for the full TTL would turn one bad second into
     thirty in which every pool reports no volume. The handler also keeps the
     rejection from surfacing as unhandled; the caller still gets the original
     promise, so it still sees the error. */
  window.catch(() => {
    if (windows.get(provider) === entry) windows.delete(provider);
  });

  return window;
}

async function computeVolumeWindow(
  provider: ethers.Provider,
): Promise<VolumeWindow | null> {
  const [head, span] = await Promise.all([
    provider.getBlock("latest"),
    chunkBlocks(provider),
  ]);
  if (!head) return null;

  /* `span - 1` back from the head, because the range is inclusive at both ends
     and a node counting `toBlock - fromBlock + 1` against its own maximum refuses
     one block wider. Measured: thirdweb's Sepolia serves 1000 and refuses 1001. */
  const fromBlock = Math.max(0, head.number - span + 1);
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
     * down instead of up. Slow blocks make that reachable: 10,000 blocks at 30s
     * apart is 83 hours. */
    scale: DAY_SEC / spanSec,
  };
}

/**
 * How much time a transactions scan aims to cover, on any chain.
 *
 * 16h rather than a round 24h because it is roughly what the old flat 5000-block
 * window *claimed* on the read chain — 5000 × 12s is 16.7h — so this keeps the
 * intent that window was written with while actually delivering it. On Sepolia
 * that is five 1000-block chunks; on Base Sepolia, three 10,000-block ones.
 */
export const TX_WINDOW_TARGET_SEC = 16 * 3600;

/**
 * Hard ceiling on chunks, whatever the block time.
 *
 * Bounds round trips rather than blocks: each chunk is three log queries and a
 * block read, so ten is at most forty calls for a pool with no activity at all,
 * and the early exit means a pool with activity almost never reaches two. Ten
 * chunks clears the 16h target with room on every configured endpoint — 10,000
 * blocks on Sepolia is 33h, 100,000 on Base Sepolia is 55h — so in practice the
 * span target is what stops the loop and this only catches a chain whose node
 * serves a very narrow range. When it does bind, the scan reports the span it
 * actually covered rather than the one it wanted.
 */
export const TX_WINDOW_MAX_CHUNKS = 10;

export interface ScanOptions<T> {
  /** Seconds of history to aim for. Defaults to `TX_WINDOW_TARGET_SEC`. */
  targetSec?: number;
  /** Chunk ceiling. Defaults to `TX_WINDOW_MAX_CHUNKS`. */
  maxChunks?: number;
  /**
   * Stop early once the rows gathered so far are enough.
   *
   * This is what keeps the widened window free for the pools that do not need
   * it. Chunks run newest-first, so a busy pool fills its quota in the first
   * one and costs exactly what a single fixed window used to; only a quiet pool
   * pays for more chunks — and a quiet pool is precisely the case that renders
   * a misleadingly empty table today.
   */
  enough?: (rows: readonly T[]) => boolean;
}

export interface ScanResult<T> {
  rows: T[];
  /** Blocks actually covered, head included. */
  blocks: number;
  /** Seconds actually covered, measured from block timestamps. Null if unread. */
  seconds: number | null;
}

/**
 * Walks back from the chain head in node-sized chunks, gathering rows.
 *
 * `read` is called once per chunk with an inclusive block range and must not
 * span wider than it is given — that is the whole reason this exists rather
 * than one `getLogs` over the target span. The chunk width comes from
 * `chunkBlocks`, so a caller cannot hand the node a range it will refuse.
 */
export async function scanBackwards<T>(
  provider: ethers.Provider,
  read: (fromBlock: number, toBlock: number) => Promise<T[]>,
  options: ScanOptions<T> = {},
): Promise<ScanResult<T>> {
  const targetSec = options.targetSec ?? TX_WINDOW_TARGET_SEC;
  const maxChunks = options.maxChunks ?? TX_WINDOW_MAX_CHUNKS;
  const enough = options.enough ?? (() => false);

  const [head, width] = await Promise.all([
    provider.getBlock("latest"),
    chunkBlocks(provider),
  ]);
  if (!head) throw new Error("could not read the chain head");

  const rows: T[] = [];
  let toBlock = head.number;
  let oldest = head.number;
  let seconds: number | null = null;

  for (let chunk = 0; chunk < maxChunks; chunk += 1) {
    const fromBlock = Math.max(0, toBlock - width + 1);
    rows.push(...(await read(fromBlock, toBlock)));
    oldest = fromBlock;

    /* Measured from the two blocks' own timestamps, never derived from the block
     * count — deriving it is the bug this module exists to fix. A block that
     * cannot be read leaves the span null, and the loop then relies on the chunk
     * ceiling to terminate rather than on a guess. */
    const tail = await provider.getBlock(fromBlock);
    seconds = tail ? head.timestamp - tail.timestamp : null;

    if (enough(rows)) break;
    if (seconds !== null && seconds >= targetSec) break;
    if (fromBlock === 0) break;
    toBlock = fromBlock - 1;
  }

  return { rows, blocks: head.number - oldest + 1, seconds };
}
