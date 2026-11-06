import { NATIVE_SENTINEL } from "@/constants/registry";

const FLY_API = "https://api.fly.trade";

/** Fly's network names are deliberately explicit: unsupported chains fail closed. */
const FLY_NETWORKS: Record<number, string> = {
  56: "bsc",
  5042: "arc",
  4663: "outlaw",
};

/* The API currently returns the same audited execution router on the three
 * Kaleido mainnets. Keep this allow-list local so a provider upgrade cannot
 * silently redirect an approval to an arbitrary contract. */
const FLY_ROUTERS: Record<number, string> = {
  56: "0x20f6ee51340adeed01a59b0e65cb3703f3dc860c",
  5042: "0x20f6ee51340adeed01a59b0e65cb3703f3dc860c",
  4663: "0x20f6ee51340adeed01a59b0e65cb3703f3dc860c",
};

export interface FlyTradeExecution {
  to: string;
  data: string;
  value: string;
  spender: string;
  amountOut: string;
}

export function flyTradeNetwork(chainId: number): string | undefined {
  return FLY_NETWORKS[chainId];
}

export function flyTradeRouter(chainId: number): string | undefined {
  return FLY_ROUTERS[chainId];
}

export function hasFlyTrade(chainId: number): boolean {
  return Boolean(FLY_NETWORKS[chainId] && FLY_ROUTERS[chainId]);
}

export function isKnownFlyTradeRouter(
  chainId: number | undefined,
  address: string,
): boolean {
  const known = chainId === undefined ? undefined : FLY_ROUTERS[chainId];
  return Boolean(known && address && address.toLowerCase() === known.toLowerCase());
}

function apiHeaders(): HeadersInit {
  const key = process.env.FLY_TRADE_API_KEY ?? process.env.FLY_API_KEY;
  return key ? { apikey: key } : {};
}

/** Resolve an executable Fly quote. This runs server-side or through the API proxy below. */
export async function resolveFlyTrade(args: {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountUnits: string;
  address: string;
  slippageBps: number;
}): Promise<FlyTradeExecution | null> {
  const network = FLY_NETWORKS[args.chainId];
  const router = FLY_ROUTERS[args.chainId];
  if (!network || !router) return null;
  try {
    const qs = new URLSearchParams({
      network,
      fromTokenAddress: args.tokenIn,
      toTokenAddress: args.tokenOut,
      sellAmount: args.amountUnits,
      slippage: String(Math.max(1, Math.min(args.slippageBps, 5000)) / 10_000),
      fromAddress: args.address,
      toAddress: args.address,
      gasless: "false",
    });
    const quoteRes = await fetch(`${FLY_API}/aggregator/quote?${qs}`, {
      headers: apiHeaders(),
      cache: "no-store",
    });
    if (!quoteRes.ok) return null;
    const quote = (await quoteRes.json()) as {
      id?: string;
      amountOut?: string;
      targetAddress?: string;
    };
    if (
      !quote.id ||
      !quote.amountOut ||
      !/^\d+$/.test(quote.amountOut) ||
      quote.targetAddress?.toLowerCase() !== router.toLowerCase()
    )
      return null;

    const txRes = await fetch(
      `${FLY_API}/aggregator/transaction?quoteId=${encodeURIComponent(quote.id)}`,
      { headers: apiHeaders(), cache: "no-store" },
    );
    if (!txRes.ok) return null;
    const tx = (await txRes.json()) as {
      to?: string;
      data?: string;
      value?: string | number;
      transaction?: { to?: string; data?: string; value?: string | number };
    };
    const raw = tx.transaction ?? tx;
    if (!raw.to || !raw.data || !isKnownFlyTradeRouter(args.chainId, raw.to))
      return null;
    return {
      to: raw.to,
      data: raw.data,
      value:
        raw.value === undefined
          ? args.tokenIn.toLowerCase() === NATIVE_SENTINEL.dex.toLowerCase()
            ? args.amountUnits
            : "0"
          : String(raw.value),
      spender: raw.to,
      amountOut: quote.amountOut,
    };
  } catch {
    return null;
  }
}

export async function getFlyTradeExecution(args: Parameters<typeof resolveFlyTrade>[0]): Promise<FlyTradeExecution | null> {
  if (typeof window === "undefined") return resolveFlyTrade(args);
  try {
    const qs = new URLSearchParams({
      chainId: String(args.chainId),
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountUnits: args.amountUnits,
      address: args.address,
      slippageBps: String(args.slippageBps),
    });
    const res = await fetch(`/api/swap/fly/quote?${qs}`);
    if (!res.ok) return null;
    const body = (await res.json()) as FlyTradeExecution;
    return body?.to && body?.data ? body : null;
  } catch {
    return null;
  }
}
