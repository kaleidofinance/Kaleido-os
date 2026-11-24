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
    chains: ZeroRouteChainStatus[];
  };
}

let cache: CachedStatus | null = null;
const CACHE_TTL_MS = 10_000;
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

  const chains = await Promise.all(ZERO_SOURCE_CHAINS.map(probeChain));
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
    chains,
  };

  cache = { ts: now, payload };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=10" },
  });
}
