/**
 * All-time volume per native pool.
 *
 * The Pools table used to show a 24h figure extrapolated from a short recent
 * block window. While our Arc pools are young and thin that window is almost
 * always empty, so every row read "—". The table now shows cumulative totals,
 * and this is where they come from.
 *
 * Each pool `Swap` log is valued by its OWN dollar leg — the pool's USD-side
 * amount (wrapped native or the 0x3600 USDC face, both $1) — not by the
 * trader's whole trade size. A route that crosses our pool and three others
 * therefore books only what actually crossed ours. A pool with no dollar leg
 * contributes nothing rather than a guess.
 *
 * Rows are keyed by (chain, tx, log index), so the points-swap cron, a
 * re-scan and a backfill can all write the same log and it counts once.
 */
import { ethers } from "ethers";

/** V3 `Swap(sender,recipient,amount0,amount1,sqrtPriceX96,liquidity,tick)`. */
export const V3_SWAP_TOPIC = ethers.id(
  "Swap(address,address,int256,int256,uint160,uint128,int24)",
);

/** Which side of a pool is the dollar, and its decimals. */
export type PoolUsdSide = { side: 0 | 1; decimals: number };

export type PoolLeg = { pool: string; logIndex: number; usd: number };

type LogLike = {
  address: string;
  topics: readonly string[];
  data: string;
  index?: number;
  logIndex?: number;
};

/**
 * The dollar size of every native-pool swap in a receipt. Pure.
 * `pools` maps a lowercased pool address to its dollar side; any other log,
 * and any pool absent from the map (no dollar leg), is ignored.
 */
export function poolLegsUsd(
  logs: readonly LogLike[],
  pools: Record<string, PoolUsdSide>,
): PoolLeg[] {
  const out: PoolLeg[] = [];
  for (const l of logs) {
    if (l.topics[0] !== V3_SWAP_TOPIC) continue;
    const pool = l.address.toLowerCase();
    const info = pools[pool];
    if (!info) continue;
    // data = amount0 (int256) | amount1 (int256) | sqrtPriceX96 | liquidity | tick
    const hex = l.data.startsWith("0x") ? l.data.slice(2) : l.data;
    if (hex.length < 128) continue;
    const word = hex.slice(info.side * 64, info.side * 64 + 64);
    let amount = BigInt.asIntN(256, BigInt("0x" + word));
    if (amount < BigInt(0)) amount = -amount;
    const usd = Number(ethers.formatUnits(amount, info.decimals));
    if (!(usd > 0)) continue;
    out.push({ pool, logIndex: Number(l.index ?? l.logIndex ?? 0), usd });
  }
  return out;
}

const POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

const sideCache = new Map<string, PoolUsdSide | null>();

/**
 * Each pool's dollar side, read once per process. `usdTokens` maps a
 * lowercased dollar-token address to its decimals. A pool whose read fails is
 * retried next time rather than cached as having none.
 */
export async function readPoolUsdSides(
  provider: ethers.Provider,
  pools: readonly string[],
  usdTokens: Record<string, number>,
): Promise<Record<string, PoolUsdSide>> {
  const out: Record<string, PoolUsdSide> = {};
  for (const raw of pools) {
    const pool = raw.toLowerCase();
    if (!sideCache.has(pool)) {
      try {
        const c = new ethers.Contract(pool, POOL_ABI, provider);
        const [t0, t1] = (await Promise.all([c.token0(), c.token1()])).map(
          (a: string) => a.toLowerCase(),
        );
        const side: PoolUsdSide | null =
          usdTokens[t0] !== undefined
            ? { side: 0, decimals: usdTokens[t0] }
            : usdTokens[t1] !== undefined
              ? { side: 1, decimals: usdTokens[t1] }
              : null;
        sideCache.set(pool, side);
      } catch {
        continue;
      }
    }
    const side = sideCache.get(pool);
    if (side) out[pool] = side;
  }
  return out;
}

/** Totals per pool, as the `pool_volume_totals` view returns them. */
export type PoolVolumeTotal = { volumeUsd: number; swaps: number };

/** Key a total by chain + lowercased pool address. */
export const poolTotalKey = (chainId: number, pool: string) =>
  `${chainId}:${pool.toLowerCase()}`;

/** Fees a pool earned on a volume, at its fee in basis points. Pure. */
export function feesOn(volumeUsd: number | null, feeBps: number | null): number | null {
  if (volumeUsd === null || feeBps === null) return null;
  if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps >= 10_000) return null;
  return (volumeUsd * feeBps) / 10_000;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any } | null;

/**
 * Write pool legs to the ledger. Fail-open like the swap ledger: a miss never
 * blocks the cron, and a later backfill re-writes it (idempotent per log).
 * Returns how many rows were written.
 */
export async function recordPoolVolume(
  admin: Admin,
  chainId: number,
  txHash: string,
  occurredAt: string,
  legs: readonly PoolLeg[],
): Promise<number> {
  if (!admin || legs.length === 0) return 0;
  try {
    const { error } = await admin.from("pool_volume").upsert(
      legs.map((l) => ({
        chain_id: chainId,
        tx_hash: txHash.toLowerCase(),
        log_index: l.logIndex,
        pool: l.pool,
        usd_value: l.usd,
        occurred_at: occurredAt,
      })),
      { onConflict: "chain_id,tx_hash,log_index", ignoreDuplicates: true },
    );
    return error ? 0 : legs.length;
  } catch {
    return 0;
  }
}

/**
 * Every pool's all-time totals, keyed by `poolTotalKey`. Null when the ledger
 * cannot be read — callers then show no total rather than zero.
 */
export async function readPoolVolumeTotals(
  admin: Admin,
): Promise<Map<string, PoolVolumeTotal> | null> {
  if (!admin) return null;
  try {
    const { data, error } = await admin
      .from("pool_volume_totals")
      .select("chain_id, pool, volume_usd, swaps");
    if (error || !Array.isArray(data)) return null;
    const out = new Map<string, PoolVolumeTotal>();
    for (const r of data as {
      chain_id: number;
      pool: string;
      volume_usd: string | number;
      swaps: string | number;
    }[]) {
      out.set(poolTotalKey(Number(r.chain_id), r.pool), {
        volumeUsd: Number(r.volume_usd),
        swaps: Number(r.swaps),
      });
    }
    return out;
  } catch {
    return null;
  }
}
