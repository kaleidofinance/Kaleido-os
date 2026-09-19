/**
 * The V3 pool sweep, extracted from useV3Pools so it runs SERVER-SIDE too.
 *
 * Every function here is a plain async read — no React — so `/api/pools` can
 * run the whole sweep once on the server and hand every browser a cached list,
 * instead of each client fanning out hundreds of slow calls at an Arc RPC. The
 * hook imports `sweepChain` from here and still runs it client-side as the
 * fallback when the endpoint is unreachable.
 */
import { ethers } from "ethers";

import { SEEDED_POOLS, getContracts, isSeededPool } from "@/constants/registry";
import { chainTokens } from "@/constants/tokens";
import type { IToken, ITradingPair } from "@/constants/types/dex";
import { FEE_TIERS } from "@/lib/dex/liquidity";
import { readPoolTiers, type PoolState } from "@/lib/dex/pool";
import { poolOrderInverted } from "@/constants/utils/v3Math";
import { readVolumeWindow, type VolumeWindow } from "@/lib/dex/logWindow";
import type { DiscoveryChain } from "@/lib/dex/poolDiscovery";
import type { PriceLookup } from "@/lib/market/spot";
import { retryRpc } from "@/lib/dex/rpcRetry";

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

const round2 = (n: number | null) =>
  n === null || !Number.isFinite(n) ? null : Number(n.toFixed(2));

/**
 * A V3 pool can have an initialized opening tick without any active
 * liquidity. That tick is not a live market quote: an empty pool has no
 * executable price, and showing it makes a newly-created pool look like it is
 * trading at an arbitrary ratio. Keep the rule beside the sweep so the table,
 * detail page and deposit flow all receive the same null.
 */
export function livePoolPrice(
  price: number | null,
  liquidity: string,
): number | null {
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  try {
    return BigInt(liquidity) > 0n ? price : null;
  } catch {
    return null;
  }
}

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
    const rawPrice =
      priceAB === null || !Number.isFinite(priceAB) || priceAB <= 0
        ? null
        : inverted
          ? 1 / priceAB
          : priceAB;
    const price = livePoolPrice(rawPrice, found.state.liquidity);

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
      /* From the committed deployment records rather than from anything on
         chain. A pool does not know who created it: `createAndInitialize` has
         no memory of its caller, PoolCreated names the factory's caller only
         in a log this sweep does not read, and the first position could have
         been transferred since. The record is the evidence, and it is the
         same file the seeding run wrote. */
      seeded: isSeededPool(chain.chainId, found.state.address),
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
/* token0/token1/fee off a pool address — enough to rebuild a row from a known
   pool without rediscovering it through the pair-probe. */
const POOL_META_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function fee() external view returns (uint24)",
];

/* How long the O(N²) pair-probe gets before the seeded pools are returned
   without it. Comfortably under the chain deadline (poolDiscovery's 20s) so a
   slow probe never drops the seeded rows by taking the whole budget. */
const PROBE_BUDGET_MS = 9_000;

/**
 * Read OUR OWN seeded pools directly from their recorded addresses.
 *
 * The pair-probe below rediscovers every pool by asking `getPool` for each
 * registered pair × tier. On a chain with many tokens over a rate-limited node
 * that is hundreds of calls — Arc lists 26 tokens, ~900 probes — and the chain
 * deadline truncates it long before it reaches the two pools we opened. So a
 * pool we KNOW the address of would never list, which is exactly what happened.
 * This reads them straight from SEEDED_POOLS in a handful of calls: the tokens
 * come off the pool itself, mapped back to the registry for their display, and
 * the state through the same `readPoolTiers`/`buildPool` path as a probed pool.
 */
async function readSeededPools(
  chain: DiscoveryChain,
  priceOf: PriceLookup,
  window: VolumeWindow | null,
): Promise<ITradingPair[]> {
  const addresses = SEEDED_POOLS[chain.chainId] ?? [];
  if (addresses.length === 0) return [];

  const byAddress = new Map(
    chainTokens(chain.chainId).map((t) => [t.address.toLowerCase(), t]),
  );

  const rows = await Promise.all(
    addresses.map(async (address) => {
      try {
        const meta = new ethers.Contract(address, POOL_META_ABI, chain.provider);
        const [t0, t1, fee] = await retryRpc(() =>
          Promise.all([meta.token0(), meta.token1(), meta.fee()]),
        );
        const tokenA = byAddress.get(String(t0).toLowerCase());
        const tokenB = byAddress.get(String(t1).toLowerCase());
        /* A pool whose tokens this chain no longer lists can't be shown as a
           pair — skip it rather than render half a row. */
        if (!tokenA || !tokenB) return null;

        const tiers = await readPoolTiers(
          chain.provider,
          chain.chainId,
          tokenA.address,
          tokenB.address,
          [Number(fee)],
          tokenA.decimals,
          tokenB.decimals,
        );
        const state = tiers.get(Number(fee));
        if (!state) return null;
        return buildPool(
          { state, fee: Number(fee), tokenA, tokenB },
          chain,
          priceOf,
          window,
        );
      } catch {
        return null;
      }
    }),
  );

  return rows.filter((p): p is ITradingPair => p !== null);
}

/** The O(N²) pair-probe — every registered pair × tier, best fill wins. */
/** A base asset pools are quoted against — where a real pool actually is. */
const isQuoteAsset = (t: IToken): boolean =>
  (t.tags ?? []).some(
    (tag) =>
      tag === "wrapped-native" ||
      tag === "stablecoin" ||
      tag === "native-alias",
  );

/* Above this many pairs the exhaustive O(N²) probe is not worth its cost: a
   chain with many tokens (Arc lists 26) is hundreds of getPool calls over a
   rate-limited node, and nearly all of them return nothing because a real pool
   quotes against a base asset, not against another arbitrary token. */
const FULL_PROBE_MAX_PAIRS = 80;

async function probePools(
  tokens: IToken[],
  chain: DiscoveryChain,
  priceOf: PriceLookup,
  window: VolumeWindow | null,
): Promise<ITradingPair[]> {
  const allPairs = unorderedPairs(tokens);
  /* Full probe while it is cheap; once it isn't, keep only pairs that include a
     base asset (USDC / wrapped-native / a stablecoin). That finds every X/base
     pool — which in practice is all of them — for a fraction of the calls, so
     the table fills in seconds instead of timing out against the deadline. */
  const pairs =
    allPairs.length <= FULL_PROBE_MAX_PAIRS
      ? allPairs
      : allPairs.filter(([a, b]) => isQuoteAsset(a) || isQuoteAsset(b));

  const probed = await mapLimit(
    pairs,
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

export async function sweepChain(
  chain: DiscoveryChain,
  priceOf: PriceLookup,
): Promise<ITradingPair[]> {
  if (!getContracts(chain.chainId).v3Factory) return [];

  /* A window this chain's node will not give up is survivable: the pools still
     list, with no volume rather than no pools. Volume is one column and it is
     already nullable; the pools are the page. */
  const window = await readVolumeWindow(chain.provider).catch(() => null);

  /* Our own seeded pools first and unconditionally — see readSeededPools. */
  const seeded = await readSeededPools(chain, priceOf, window);

  /* Then the full probe for anything else, on its own budget: on a many-token
     chain it cannot finish inside the deadline, and letting it run the deadline
     out would drop the seeded pools with it. Keep whatever it returned in time. */
  const tokens = sweepTokens(chain.chainId);
  const probed =
    tokens.length < 2
      ? []
      : await Promise.race([
          probePools(tokens, chain, priceOf, window),
          new Promise<ITradingPair[]>((resolve) =>
            setTimeout(() => resolve([]), PROBE_BUDGET_MS),
          ),
        ]).catch(() => [] as ITradingPair[]);

  const seen = new Set(seeded.map((p) => p.address.toLowerCase()));
  return [
    ...seeded,
    ...probed.filter((p) => !seen.has(p.address.toLowerCase())),
  ];
}
