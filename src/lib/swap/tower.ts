import { NATIVE_SENTINEL } from "@/constants/registry";

export const TOWER_API = "https://api.tower.exchange";

/** Tower's network slugs on Arc mainnet and testnet. */
const TOWER_NETWORKS: Record<number, string> = {
  5042: "arc",
  5042002: "arc-testnet",
};

/**
 * TowerSwapExecutor on Arc.
 * Whitelisted execution router for Arc mainnet (5042) and paired testnet (5042002).
 * Can be overridden via TOWER_ROUTER_ADDRESS environment variable if needed.
 */
const DEFAULT_TOWER_ROUTER_ARC = "0x58c081e6F47A704943E99c0Ec719b4b9b9B829c9";

const TOWER_ROUTERS: Record<number, string> = {
  5042: process.env.TOWER_ROUTER_ADDRESS || DEFAULT_TOWER_ROUTER_ARC,
  5042002: process.env.TOWER_TESTNET_ROUTER_ADDRESS || DEFAULT_TOWER_ROUTER_ARC,
};

export interface TowerQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpactBps?: number;
  routeType?: "stablefx" | "dex_aggregator" | "hybrid";
  router: string;
}

export interface TowerExecution {
  to: string;
  data: string;
  value: string;
  spender: string;
  amountOut: string;
  priceImpactBps?: number;
  routeType?: string;
}

export function towerNetwork(chainId: number): string | undefined {
  return TOWER_NETWORKS[chainId];
}

export function towerRouter(chainId: number): string | undefined {
  return TOWER_ROUTERS[chainId];
}

export function hasTowerSwap(chainId: number): boolean {
  return Boolean(TOWER_NETWORKS[chainId] && TOWER_ROUTERS[chainId]);
}

export function isKnownTowerRouter(
  chainId: number | undefined,
  address: string,
): boolean {
  const known = chainId === undefined ? undefined : TOWER_ROUTERS[chainId];
  return Boolean(
    known && address && address.toLowerCase() === known.toLowerCase(),
  );
}

function apiHeaders(): HeadersInit {
  const key = process.env.TOWER_API_KEY;
  return {
    Accept: "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
}

/**
 * Fetch a quote from Tower Exchange for regional and global stablecoins on Arc.
 */
export async function quoteTowerSwap(args: {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountUnits: string;
  fetchImpl?: typeof fetch;
}): Promise<TowerQuote | null> {
  const network = TOWER_NETWORKS[args.chainId];
  const router = TOWER_ROUTERS[args.chainId];
  if (!network || !router) return null;

  const f = args.fetchImpl ?? fetch;
  try {
    const qs = new URLSearchParams({
      network,
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amount: args.amountUnits,
    });
    const res = await f(`${TOWER_API}/api/public/swap/quote?${qs}`, {
      headers: apiHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      amountOut?: string;
      priceImpactBps?: number;
      routeType?: "stablefx" | "dex_aggregator" | "hybrid";
      router?: string;
    };
    if (!json.amountOut || !/^\d+$/.test(json.amountOut)) return null;

    return {
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountIn: args.amountUnits,
      amountOut: json.amountOut,
      priceImpactBps: json.priceImpactBps,
      routeType: json.routeType ?? "dex_aggregator",
      router: json.router ?? router,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve an executable Tower swap transaction.
 */
export async function resolveTowerSwap(args: {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountUnits: string;
  address: string;
  slippageBps: number;
  fetchImpl?: typeof fetch;
}): Promise<TowerExecution | null> {
  const network = TOWER_NETWORKS[args.chainId];
  const router = TOWER_ROUTERS[args.chainId];
  if (!network || !router) return null;

  const f = args.fetchImpl ?? fetch;
  try {
    const res = await f(`${TOWER_API}/api/public/swap/build-tx`, {
      method: "POST",
      headers: {
        ...apiHeaders(),
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        network,
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        amountIn: args.amountUnits,
        recipient: args.address,
        slippageBps: Math.max(1, Math.min(args.slippageBps, 5000)),
      }),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      to?: string;
      data?: string;
      value?: string;
      spender?: string;
      amountOut?: string;
      priceImpactBps?: number;
      routeType?: string;
    };

    if (!data.to || !data.data || !data.amountOut) return null;
    const targetRouter = data.to.toLowerCase();
    if (targetRouter !== router.toLowerCase()) return null;

    return {
      to: data.to,
      data: data.data,
      value: data.value ?? "0",
      spender: data.spender ?? router,
      amountOut: data.amountOut,
      priceImpactBps: data.priceImpactBps,
      routeType: data.routeType,
    };
  } catch {
    return null;
  }
}
