import { NextResponse } from "next/server";
import { ethers } from "ethers";
import {
  ZERO_AUTOBRIDGE_ABI,
  ZERO_CHAIN_ID,
  ZERO_DST_EID,
  ZERO_FEE_BPS,
  ZERO_LAUNCH_DATE,
  ZERO_PUBLIC_RPC,
  ZERO_SOURCE_CHAINS,
  ZRO_OFT_ABI,
  ZRO_OFT_ADDRESS,
  buildZeroSendParam,
  getZeroAutoBridgeAddress,
  type ZeroSourceChain,
} from "@/lib/bridge/zero";

export const dynamic = "force-dynamic";

export interface ZeroRouteChainStatus {
  key: ZeroSourceChain["key"];
  chainId: number;
  name: string;
  shortName: string;
  nativeSymbol: string;
  open: boolean;
  nativeFeeWei: string | null;
  nativeFeeFormatted: string | null;
  autoBridgeAddress: string | null;
  queueLength: number | null;
  probeError?: string;
}

interface CachedStatus {
  ts: number;
  payload: {
    updatedAt: string;
    zeroChainId: number;
    zeroDstEid: number;
    zeroRpc: string | null;
    zroAddress: string;
    feeBps: number;
    launchDate: string;
    openCount: number;
    pricesUsd: Record<string, number>;
    chains: ZeroRouteChainStatus[];
  };
}

let cache: CachedStatus | null = null;
let priceCache: { ts: number; prices: Record<string, number> } | null = null;
const CACHE_TTL_MS = 10_000;
const PRICE_TTL_MS = 60_000;

const LLAMA_COINS: Record<string, string> = {
  ZRO: "ethereum:0x6985884C4392D348587B19cb9eAAf157F13271cd",
  ETH: "coingecko:ethereum",
  BNB: "coingecko:binancecoin",
  POL: "coingecko:polygon-ecosystem-token",
  AVAX: "coingecko:avalanche-2",
  WBTC: "coingecko:wrapped-bitcoin",
  ARB: "coingecko:arbitrum",
  OP: "coingecko:optimism",
  AERO: "base:0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  CAKE: "bsc:0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  LINK: "coingecko:chainlink",
};

async function fetchZeroPricesUsd(): Promise<Record<string, number>> {
  const now = Date.now();
  if (priceCache && now - priceCache.ts < PRICE_TTL_MS) {
    return priceCache.prices;
  }
  const prices: Record<string, number> = {
    USDC: 1,
    USDT: 1,
    DAI: 1,
    FDUSD: 1,
    USD1: 1,
    USDE: 1,
  };
  try {
    const query = Object.values(LLAMA_COINS).join(",");
    const res = await fetch(`https://coins.llama.fi/prices/current/${query}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as {
        coins?: Record<string, { price?: number }>;
      };
      const coins = json?.coins ?? {};
      for (const [sym, key] of Object.entries(LLAMA_COINS)) {
        const p = coins[key]?.price;
        if (typeof p === "number" && Number.isFinite(p) && p > 0) {
          prices[sym] = p;
        }
      }
      // Mirror wrapped / pegged variants
      if (prices.ETH) prices.WETH = prices.ETH;
      if (prices.BNB) prices.WBNB = prices.BNB;
      if (prices.AVAX) prices.WAVAX = prices.AVAX;
      if (prices.WBTC) {
        prices.CBBTC = prices.WBTC;
        prices.BTCB = prices.WBTC;
        prices["BTC.B"] = prices.WBTC;
      }
    }
  } catch {
    /* keep stablecoin defaults + stale cache if any */
    if (priceCache) return priceCache.prices;
  }
  priceCache = { ts: now, prices };
  return prices;
}
const PROBE_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const PROBE_AMOUNT = ethers.parseEther("1");

async function probeChain(chain: ZeroSourceChain): Promise<ZeroRouteChainStatus> {
  const autoBridgeAddress = getZeroAutoBridgeAddress(chain.chainId);
  const sendParam = buildZeroSendParam(PROBE_ADDRESS, PROBE_AMOUNT);

  let lastErr = "";
  for (const rpc of chain.rpcUrls) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc, chain.chainId, {
        staticNetwork: true,
      });
      const oft = new ethers.Contract(ZRO_OFT_ADDRESS, ZRO_OFT_ABI, provider);

      let queueLength: number | null = null;
      if (autoBridgeAddress) {
        try {
          const ab = new ethers.Contract(
            autoBridgeAddress,
            ZERO_AUTOBRIDGE_ABI,
            provider,
          );
          const len = await Promise.race([
            ab.queueLength(),
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error("timeout")), 3500),
            ),
          ]);
          queueLength = Number(len);
        } catch {
          queueLength = null;
        }
      }

      try {
        const fee = await Promise.race([
          oft.quoteSend(sendParam, false),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("timeout")), 4500),
          ),
        ]);
        const nativeFee = BigInt(fee.nativeFee ?? fee[0]);
        return {
          key: chain.key,
          chainId: chain.chainId,
          name: chain.name,
          shortName: chain.shortName,
          nativeSymbol: chain.nativeSymbol,
          open: true,
          nativeFeeWei: nativeFee.toString(),
          nativeFeeFormatted: Number(ethers.formatEther(nativeFee)).toFixed(6),
          autoBridgeAddress,
          queueLength,
        };
      } catch (callErr) {
        const msg = callErr instanceof Error ? callErr.message : String(callErr);
        // A CALL_EXCEPTION / execution reverted means the RPC worked and LayerZero's
        // route to dstEid 33002 is currently CLOSED (rate-limited / paused).
        if (/revert|CALL_EXCEPTION|execution reverted/i.test(msg)) {
          return {
            key: chain.key,
            chainId: chain.chainId,
            name: chain.name,
            shortName: chain.shortName,
            nativeSymbol: chain.nativeSymbol,
            open: false,
            nativeFeeWei: null,
            nativeFeeFormatted: null,
            autoBridgeAddress,
            queueLength,
          };
        }
        lastErr = msg;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    key: chain.key,
    chainId: chain.chainId,
    name: chain.name,
    shortName: chain.shortName,
    nativeSymbol: chain.nativeSymbol,
    open: false,
    nativeFeeWei: null,
    nativeFeeFormatted: null,
    autoBridgeAddress,
    queueLength: null,
    probeError: lastErr.slice(0, 120) || "RPC unreachable",
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload, {
      headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=10" },
    });
  }

  const [chains, pricesUsd] = await Promise.all([
    Promise.all(ZERO_SOURCE_CHAINS.map(probeChain)),
    fetchZeroPricesUsd(),
  ]);
  const openCount = chains.filter((c) => c.open).length;

  const payload = {
    updatedAt: new Date(now).toISOString(),
    zeroChainId: ZERO_CHAIN_ID,
    zeroDstEid: ZERO_DST_EID,
    zeroRpc: ZERO_PUBLIC_RPC,
    zroAddress: ZRO_OFT_ADDRESS,
    feeBps: ZERO_FEE_BPS,
    launchDate: ZERO_LAUNCH_DATE,
    openCount,
    pricesUsd,
    chains,
  };

  cache = { ts: now, payload };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=10" },
  });
}
