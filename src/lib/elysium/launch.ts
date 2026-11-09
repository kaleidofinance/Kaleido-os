import {
  AbiCoder,
  Contract,
  ZeroAddress,
  getAddress,
  isAddress,
  keccak256,
  toBeHex,
} from "ethers";
import { providerForChain } from "@/config/provider";
import { priceFromSqrtX96 } from "@/lib/argus/poolMath";
import {
  ELYSIUM_CHAIN_ID,
  ELYSIUM_KNTQ,
  ELYSIUM_KNTQ_DECIMALS,
  ELYSIUM_LAUNCHPADS,
  ELYSIUM_POOL_MANAGERS,
  ELYSIUM_USDC,
  ELYSIUM_USDC_DECIMALS,
  ELYSIUM_V4_NATIVE,
  ELYSIUM_WHYPE,
  ELYSIUM_WHYPE_DECIMALS,
  KALOS_V3,
  type ElysiumLaunchpadId,
} from "./addresses";

export interface ElysiumPoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

export interface ElysiumLaunch {
  launchpad: ElysiumLaunchpadId;
  launchpadName: string;
  launchpadLabel: string;
  token: string;
  quoteCurrency: string;
  quoteSymbol: "HYPE" | "WHYPE" | "USDC" | "KNTQ";
  quoteDecimals: number;
  poolManager: string;
  poolKey: ElysiumPoolKey;
  poolId: string;
  tokenIs0: boolean;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  pricePerTokenInQuote: number;
  priceUsd: number | null;
  buyTaxBps?: number;
  sellTaxBps?: number;
}

const abi = AbiCoder.defaultAbiCoder();
const V4_POOLS_SLOT = 6n;
const U160 = (1n << 160n) - 1n;
const U128 = (1n << 128n) - 1n;

const EXTSLOAD_ABI = [
  "function extsload(bytes32[] slots) view returns (bytes32[])",
];
const V3_POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
  "function liquidity() view returns (uint128)",
];

/** Canonical Uniswap v4 PoolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks)). */
export function computeV4PoolId(key: ElysiumPoolKey): string {
  return keccak256(
    abi.encode(
      ["address", "address", "uint24", "int24", "address"],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

/** Storage slot of `_pools[poolId].slot0` inside a Uniswap v4 PoolManager (slot 6). */
export function v4PoolStateBaseSlot(poolId: string): bigint {
  return BigInt(
    keccak256(abi.encode(["bytes32", "uint256"], [poolId, V4_POOLS_SLOT])),
  );
}

function decodeSignedInt24(raw: bigint): number {
  const masked = Number(raw & 0xffffffn);
  return masked >= 0x800000 ? masked - 0x1000000 : masked;
}

function quoteMeta(quoteCurrency: string): {
  symbol: "HYPE" | "WHYPE" | "USDC" | "KNTQ";
  decimals: number;
} {
  const lower = quoteCurrency.toLowerCase();
  if (lower === ELYSIUM_USDC.toLowerCase()) {
    return { symbol: "USDC", decimals: ELYSIUM_USDC_DECIMALS };
  }
  if (lower === ELYSIUM_KNTQ.toLowerCase()) {
    return { symbol: "KNTQ", decimals: ELYSIUM_KNTQ_DECIMALS };
  }
  if (lower === ELYSIUM_WHYPE.toLowerCase()) {
    return { symbol: "WHYPE", decimals: ELYSIUM_WHYPE_DECIMALS };
  }
  return { symbol: "HYPE", decimals: ELYSIUM_WHYPE_DECIMALS };
}

interface Candidate {
  launchpad: ElysiumLaunchpadId;
  launchpadName: string;
  launchpadLabel: string;
  poolManager: string;
  quoteCurrency: string;
  poolKey: ElysiumPoolKey;
  poolId: string;
  tokenIs0: boolean;
  slot0Key: string;
  liqKey: string;
  transferTaxBps?: number;
}

function buildCandidatesForToken(token: string): Map<string, Candidate[]> {
  const byManager = new Map<string, Candidate[]>();
  const seenPoolIds = new Set<string>();

  const addCandidate = (
    launchpad: ElysiumLaunchpadId,
    launchpadName: string,
    launchpadLabel: string,
    poolManager: string,
    quoteCurrency: string,
    fee: number,
    tickSpacing: number,
    hooks: string,
    transferTaxBps?: number,
  ) => {
    const q = getAddress(quoteCurrency.toLowerCase());
    const h = getAddress(hooks.toLowerCase());
    if (q.toLowerCase() === token.toLowerCase()) return;
    const tokenIs0 = BigInt(token) < BigInt(q);
    const [currency0, currency1] = tokenIs0 ? [token, q] : [q, token];
    const poolKey: ElysiumPoolKey = {
      currency0,
      currency1,
      fee,
      tickSpacing,
      hooks: h,
    };
    const poolId = computeV4PoolId(poolKey);
    const dedupeKey = `${poolManager.toLowerCase()}:${poolId.toLowerCase()}`;
    if (seenPoolIds.has(dedupeKey)) return;
    seenPoolIds.add(dedupeKey);

    const base = v4PoolStateBaseSlot(poolId);
    const slot0Key = toBeHex(base, 32);
    const liqKey = toBeHex(base + 3n, 32);
    const mgrKey = getAddress(poolManager.toLowerCase());
    const list = byManager.get(mgrKey) ?? [];
    list.push({
      launchpad,
      launchpadName,
      launchpadLabel,
      poolManager: mgrKey,
      quoteCurrency: q,
      poolKey,
      poolId,
      tokenIs0,
      slot0Key,
      liqKey,
      transferTaxBps,
    });
    byManager.set(mgrKey, list);
  };

  for (const spec of ELYSIUM_LAUNCHPADS) {
    for (const hook of spec.hooks) {
      for (const quote of spec.quotes) {
        for (const tickSpacing of spec.tickSpacings) {
          for (const fee of spec.fees) {
            addCandidate(
              spec.id,
              spec.name,
              spec.badgeLabel,
              spec.poolManager,
              quote,
              fee,
              tickSpacing,
              hook,
              spec.transferTaxBps,
            );
          }
        }
      }
    }
  }

  // Also probe standard hookless Uniswap v4 pools on Shared PoolManager as fallback.
  for (const quote of [ELYSIUM_V4_NATIVE, ELYSIUM_WHYPE, ELYSIUM_USDC]) {
    for (const [fee, tickSpacing] of [
      [3000, 60],
      [10000, 200],
      [500, 10],
    ] as const) {
      addCandidate(
        "v4",
        "Uniswap v4",
        "Uniswap v4",
        ELYSIUM_POOL_MANAGERS.shared,
        quote,
        fee,
        tickSpacing,
        ZeroAddress,
      );
    }
  }

  return byManager;
}

let cachedQuoteUsd: {
  expiresAt: number;
  value: {
    hypeUsd: number | null;
    kntqUsd: number | null;
    usdcWhypeSqrtPriceX96: bigint | null;
    usdcWhypeLiquidity: bigint | null;
  };
} | null = null;
let inflightQuoteUsd: Promise<{
  hypeUsd: number | null;
  kntqUsd: number | null;
  usdcWhypeSqrtPriceX96: bigint | null;
  usdcWhypeLiquidity: bigint | null;
}> | null = null;

/**
 * Read live HYPE/USD and KNTQ/USD prices from Kalos V3 pools on Elysium Mainnet
 * so HYPE- and KNTQ-denominated launchpad pools can report accurate USD prices
 * and market caps on Token Cards.
 */
export async function readElysiumQuoteUsdPrices(): Promise<{
  hypeUsd: number | null;
  kntqUsd: number | null;
  usdcWhypeSqrtPriceX96: bigint | null;
  usdcWhypeLiquidity: bigint | null;
}> {
  if (cachedQuoteUsd && cachedQuoteUsd.expiresAt > Date.now()) {
    return cachedQuoteUsd.value;
  }
  if (inflightQuoteUsd) return inflightQuoteUsd;

  inflightQuoteUsd = (async () => {
    const provider = providerForChain(ELYSIUM_CHAIN_ID);
    if (!provider) {
      return {
        hypeUsd: null,
        kntqUsd: null,
        usdcWhypeSqrtPriceX96: null,
        usdcWhypeLiquidity: null,
      };
    }
    try {
      const usdcWhype = new Contract(KALOS_V3.usdcWhypePool, V3_POOL_ABI, provider);
      const kntqWhype = new Contract(KALOS_V3.kntqWhypePool, V3_POOL_ABI, provider);
      const callWithRetry = async <T>(fn: () => Promise<T>): Promise<T | null> => {
        try {
          return await fn();
        } catch {
          try {
            return await fn();
          } catch {
            return null;
          }
        }
      };
      const [uwSlot0, uwLiq, kwSlot0] = await Promise.all([
        callWithRetry(() => usdcWhype.slot0()),
        callWithRetry(() => usdcWhype.liquidity()),
        callWithRetry(() => kntqWhype.slot0()),
      ]);
      let hypeUsd: number | null = null;
      let usdcWhypeSqrtPriceX96: bigint | null = null;
      let usdcWhypeLiquidity: bigint | null = null;
      if (uwSlot0 && uwSlot0[0] && BigInt(uwSlot0[0]) > 0n) {
        usdcWhypeSqrtPriceX96 = BigInt(uwSlot0[0]);
        if (uwLiq != null) usdcWhypeLiquidity = BigInt(uwLiq);
        // token0 = USDC (0xb47c…, 6 dec), token1 = WHYPE (0xbA87…, 18 dec).
        // priceFromSqrtX96 with tokenIsToken0=false returns USDC per 1 WHYPE.
        const p = priceFromSqrtX96(
          usdcWhypeSqrtPriceX96,
          false,
          ELYSIUM_WHYPE_DECIMALS,
          ELYSIUM_USDC_DECIMALS,
        );
        if (Number.isFinite(p) && p > 0) hypeUsd = p;
      }

      let kntqUsd: number | null = null;
      if (hypeUsd != null && kwSlot0 && kwSlot0[0] && BigInt(kwSlot0[0]) > 0n) {
        // token0 = WHYPE (0xbA87…, 18 dec), token1 = KNTQ (0xe45a…, 18 dec).
        // priceFromSqrtX96 with tokenIsToken0=false returns WHYPE per 1 KNTQ.
        const kntqInHype = priceFromSqrtX96(
          BigInt(kwSlot0[0]),
          false,
          ELYSIUM_KNTQ_DECIMALS,
          ELYSIUM_WHYPE_DECIMALS,
        );
        if (Number.isFinite(kntqInHype) && kntqInHype > 0) {
          kntqUsd = kntqInHype * hypeUsd;
        }
      }

      const value = { hypeUsd, kntqUsd, usdcWhypeSqrtPriceX96, usdcWhypeLiquidity };
      if (hypeUsd != null) {
        cachedQuoteUsd = { expiresAt: Date.now() + 15_000, value };
      }
      return value;
    } catch {
      return {
        hypeUsd: null,
        kntqUsd: null,
        usdcWhypeSqrtPriceX96: null,
        usdcWhypeLiquidity: null,
      };
    } finally {
      inflightQuoteUsd = null;
    }
  })();

  return inflightQuoteUsd;
}

const launchCache = new Map<
  string,
  { expiresAt: number; value: ElysiumLaunch | null }
>();
const inflightLaunch = new Map<string, Promise<ElysiumLaunch | null>>();

/**
 * Probe all 12 Elysium Launchpads across all 5 Uniswap v4 PoolManager singletons
 * in a single parallel round-trip (`extsload(bytes32[] slots)`).
 *
 * Returns the active launchpad pool and its live price/liquidity, or null if the
 * token is not launched on any Elysium v4 pool.
 */
export async function readElysiumLaunch(
  tokenAddress: string,
  tokenDecimals = 18,
): Promise<ElysiumLaunch | null> {
  if (!tokenAddress || !isAddress(tokenAddress.toLowerCase())) return null;
  const cacheKey = `${tokenAddress.toLowerCase()}:${tokenDecimals}`;
  const cached = launchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const inflight = inflightLaunch.get(cacheKey);
  if (inflight) return inflight;

  const job = (async (): Promise<ElysiumLaunch | null> => {
    const provider = providerForChain(ELYSIUM_CHAIN_ID);
    if (!provider) return null;

    const token = getAddress(tokenAddress.toLowerCase());
    const byManager = buildCandidatesForToken(token);

    const [managerHits, quotePrices] = await Promise.all([
      Promise.all(
        Array.from(byManager.entries()).map(async ([poolManager, candidates]) => {
          try {
            const pm = new Contract(poolManager, EXTSLOAD_ABI, provider);
            const slots = candidates.flatMap((c) => [c.slot0Key, c.liqKey]);
            let values: string[];
            try {
              values = (await pm.extsload(slots)) as string[];
            } catch {
              await new Promise((r) => setTimeout(r, 200));
              values = (await pm.extsload(slots)) as string[];
            }
            const hits: Array<{
              candidate: Candidate;
              sqrtPriceX96: bigint;
              tick: number;
              liquidity: bigint;
            }> = [];
            for (let i = 0; i < candidates.length; i++) {
              const rawSlot0 = BigInt(values[i * 2] ?? "0x0");
              const sqrtPriceX96 = rawSlot0 & U160;
              if (sqrtPriceX96 === 0n) continue;
              const tick = decodeSignedInt24(rawSlot0 >> 160n);
              const rawLiq = BigInt(values[i * 2 + 1] ?? "0x0");
              const liquidity = rawLiq & U128;
              hits.push({
                candidate: candidates[i],
                sqrtPriceX96,
                tick,
                liquidity,
              });
            }
            return hits;
          } catch {
            return [];
          }
        }),
      ),
      readElysiumQuoteUsdPrices(),
    ]);

    const allHits = managerHits.flat();
    if (allHits.length === 0) return null;

    // Prefer named launchpads over generic v4, then highest liquidity.
    allHits.sort((a, b) => {
      const aNamed = a.candidate.launchpad !== "v4" ? 1 : 0;
      const bNamed = b.candidate.launchpad !== "v4" ? 1 : 0;
      if (aNamed !== bNamed) return bNamed - aNamed;
      if (a.liquidity !== b.liquidity) return a.liquidity > b.liquidity ? -1 : 1;
      return 0;
    });

    const best = allHits[0];
    const { candidate, sqrtPriceX96, tick, liquidity } = best;
    const qMeta = quoteMeta(candidate.quoteCurrency);
    const pricePerTokenInQuote = priceFromSqrtX96(
      sqrtPriceX96,
      candidate.tokenIs0,
      tokenDecimals,
      qMeta.decimals,
    );

    let priceUsd: number | null = null;
    if (Number.isFinite(pricePerTokenInQuote) && pricePerTokenInQuote > 0) {
      if (qMeta.symbol === "USDC") {
        priceUsd = pricePerTokenInQuote;
      } else if (
        (qMeta.symbol === "HYPE" || qMeta.symbol === "WHYPE") &&
        quotePrices.hypeUsd != null
      ) {
        priceUsd = pricePerTokenInQuote * quotePrices.hypeUsd;
      } else if (qMeta.symbol === "KNTQ" && quotePrices.kntqUsd != null) {
        priceUsd = pricePerTokenInQuote * quotePrices.kntqUsd;
      }
    }

    const result: ElysiumLaunch = {
      launchpad: candidate.launchpad,
      launchpadName: candidate.launchpadName,
      launchpadLabel: candidate.launchpadLabel,
      token,
      quoteCurrency: candidate.quoteCurrency,
      quoteSymbol: qMeta.symbol,
      quoteDecimals: qMeta.decimals,
      poolManager: candidate.poolManager,
      poolKey: candidate.poolKey,
      poolId: candidate.poolId,
      tokenIs0: candidate.tokenIs0,
      sqrtPriceX96,
      tick,
      liquidity,
      pricePerTokenInQuote,
      priceUsd,
      ...(candidate.transferTaxBps != null
        ? {
            buyTaxBps: candidate.transferTaxBps,
            sellTaxBps: candidate.transferTaxBps,
          }
        : {}),
    };
    launchCache.set(cacheKey, { expiresAt: Date.now() + 5_000, value: result });
    return result;
  })();

  inflightLaunch.set(cacheKey, job);
  try {
    return await job;
  } finally {
    inflightLaunch.delete(cacheKey);
  }
}
