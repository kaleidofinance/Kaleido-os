import { NATIVE_SENTINEL } from "@/constants/registry";
import {
  lifiAuthHeaders,
  lifiMonetizationParams,
} from "@/lib/bridge/lifiServer";

const LIFI_API = "https://li.quest/v1";

/* LI.FI uses the deterministic diamond on most EVM chains, with the deployed
 * chain-specific executors already audited for Arc and Robinhood. Keep this
 * list local so a provider response can never redirect an approval to an
 * arbitrary contract. */
const LIFI_ROUTERS: Record<number, string> = {
  56: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
  5042: "0xA4072583658Fae592A3506A42431cb6316a8d40b",
  4663: "0xB477751B76CF82d00a686A1232f5fCD772414Af3",
};

export interface LifiSwapExecution {
  to: string;
  data: string;
  value: string;
  spender: string;
  amountOut: string;
}

export function lifiSwapRouter(chainId: number): string | undefined {
  return LIFI_ROUTERS[chainId];
}

export function hasLifiSwap(chainId: number): boolean {
  return Boolean(LIFI_ROUTERS[chainId]);
}

export function isKnownLifiSwapRouter(
  chainId: number | undefined,
  address: string,
): boolean {
  const known = chainId === undefined ? undefined : LIFI_ROUTERS[chainId];
  return Boolean(
    known && address && address.toLowerCase() === known.toLowerCase(),
  );
}

export async function resolveLifiSwap(args: {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountUnits: string;
  address: string;
  slippageBps: number;
  fetchImpl?: typeof fetch;
}): Promise<LifiSwapExecution | null> {
  const router = LIFI_ROUTERS[args.chainId];
  if (!router) return null;
  try {
    const qs = new URLSearchParams({
      fromChain: String(args.chainId),
      toChain: String(args.chainId),
      fromToken: args.tokenIn,
      toToken: args.tokenOut,
      fromAmount: args.amountUnits,
      fromAddress: args.address,
      toAddress: args.address,
      slippage: String(Math.max(1, Math.min(args.slippageBps, 5000)) / 10_000),
      ...lifiMonetizationParams(),
    });
    const doFetch = args.fetchImpl ?? fetch;
    const res = await doFetch(`${LIFI_API}/quote?${qs}`, {
      headers: lifiAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const quote = (await res.json()) as {
      estimate?: { toAmount?: string; approvalAddress?: string };
      transactionRequest?: {
        to?: string;
        data?: string;
        value?: string | number;
      };
    };
    const tx = quote.transactionRequest;
    const amountOut = quote.estimate?.toAmount;
    if (
      !tx?.to ||
      !tx.data ||
      !amountOut ||
      !/^\d+$/.test(amountOut) ||
      amountOut === "0"
    )
      return null;
    if (!isKnownLifiSwapRouter(args.chainId, tx.to)) return null;
    const spender = quote.estimate?.approvalAddress ?? tx.to;
    if (
      !isKnownLifiSwapRouter(args.chainId, spender) ||
      spender.toLowerCase() !== tx.to.toLowerCase()
    )
      return null;
    return {
      to: tx.to,
      data: tx.data,
      value:
        tx.value === undefined
          ? args.tokenIn.toLowerCase() === NATIVE_SENTINEL.dex.toLowerCase()
            ? args.amountUnits
            : "0"
          : String(tx.value),
      spender,
      amountOut,
    };
  } catch {
    return null;
  }
}

export async function getLifiSwapExecution(
  args: Parameters<typeof resolveLifiSwap>[0],
): Promise<LifiSwapExecution | null> {
  if (typeof window === "undefined") return resolveLifiSwap(args);
  try {
    const qs = new URLSearchParams({
      chainId: String(args.chainId),
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountUnits: args.amountUnits,
      address: args.address,
      slippageBps: String(args.slippageBps),
    });
    const res = await fetch(`/api/swap/lifi/quote?${qs}`);
    if (!res.ok) return null;
    const body = (await res.json()) as LifiSwapExecution;
    return body?.to && body?.data ? body : null;
  } catch {
    return null;
  }
}
