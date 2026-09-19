/**
 * KyberSwap aggregator swap routes, for chains where Kaleido runs no pools of
 * its own (Arc, whose liquidity is Uniswap V3/V4 that our V3-fork quoter cannot
 * read). KyberSwap does the pool discovery across both Uniswap versions and
 * returns executable calldata; we take our own fee through its integrator-fee
 * params — the same 0.2% the bridges take — charged on the input token.
 *
 * Isomorphic like the bridge resolver: getKyberSwapExecution runs in the browser
 * (useLocalPlanner) and on the server (serverPlanDeps). The fee receiver and rate
 * are server secrets, so the browser reaches KyberSwap through /api/swap/quote
 * and the server calls it directly — both return the identical shape parsed by
 * the caller. See lib/swap/kyberswapServer.ts and app/api/swap/quote/route.ts.
 */

import { kyberFeeParams, kyberClientId } from "./kyberswapServer";
import { NATIVE_SENTINEL } from "@/constants/registry";

const KYBER_API = "https://aggregator-api.kyberswap.com";

/**
 * Chains we route swaps through KyberSwap on, by the slug its API expects. Only
 * Arc today: it is the chain we launched on with no Kaleido pools. Extend this
 * as we reach another chain the same way; a chain absent here has no KyberSwap
 * swap route and the planner falls back to refusing (or to our own pools).
 */
const KYBERSWAP_CHAIN_SLUG: Record<number, string> = {
  5042: "arc",
};

/**
 * KyberSwap's MetaAggregationRouter per chain — the contract its build calldata
 * targets and that an approve authorises. Verified on-chain (Arc: 13.7KB code).
 * Whitelisted like the LI.FI routers: an aggregator `to` is otherwise bounded
 * only by the auditor's USD cap, and the resolver refuses a build whose returned
 * router is not this one, so a KyberSwap upgrade fails closed rather than routing
 * an approve to an address we never checked.
 */
const KYBERSWAP_ROUTERS: Record<number, string> = {
  5042: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
};

export function kyberSwapChainSlug(chainId: number): string | undefined {
  return KYBERSWAP_CHAIN_SLUG[chainId];
}

export function kyberSwapRouter(chainId: number): string | undefined {
  return KYBERSWAP_ROUTERS[chainId];
}

/** Whether swaps on this chain can route through KyberSwap at all. */
export function hasKyberSwap(chainId: number): boolean {
  return Boolean(KYBERSWAP_CHAIN_SLUG[chainId] && KYBERSWAP_ROUTERS[chainId]);
}

/**
 * A quote only — the aggregator's `amountOut` for a pair, no calldata built.
 *
 * For the read side (getSwapRoute): "is this tradable, and at what rate" on a
 * chain whose liquidity our own quoter cannot see. It is the same /routes call
 * resolveKyberSwap starts with, with the same fee parameters, so the rate this
 * reports is the rate a plan would be built from. `fetchImpl` is a test seam.
 * Returns null on any failure — the caller then says "no route", never guesses.
 */
export async function quoteKyberSwap(args: {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountUnits: string;
  fetchImpl?: typeof fetch;
}): Promise<{ amountOut: string } | null> {
  const slug = KYBERSWAP_CHAIN_SLUG[args.chainId];
  if (!slug) return null;
  const doFetch = args.fetchImpl ?? fetch;
  try {
    const qs = new URLSearchParams({
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountIn: args.amountUnits,
      ...kyberFeeParams(),
    });
    const res = await doFetch(`${KYBER_API}/${slug}/api/v1/routes?${qs}`, {
      headers: { "x-client-id": kyberClientId() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { routeSummary?: { amountOut?: unknown } };
    };
    const out = json.data?.routeSummary?.amountOut;
    return typeof out === "string" && /^\d+$/.test(out) && out !== "0"
      ? { amountOut: out }
      : null;
  } catch {
    return null;
  }
}

/**
 * The ERC20 an aggregator trades for a token whose own form it cannot pull.
 *
 * Arc's native gas token IS USDC, so "USDC" resolves to the native sentinel —
 * which has no ERC20 code, so an `approve`/`allowance` on it dies with "could
 * not decode result data". KyberSwap quotes, and its router pulls, the `0x3600`
 * ERC20 FACE of native USDC: a 6-decimal mirror whose `balanceOf` is the native
 * balance and whose `transferFrom` moves it (verified on-chain). So a swap of
 * native USDC must approve and route THAT, not the sentinel. Every other token
 * trades as itself.
 */
const NATIVE_SWAP_ERC20: Record<
  number,
  { address: string; symbol: string; decimals: number }
> = {
  5042: {
    address: "0x3600000000000000000000000000000000000000",
    symbol: "USDC",
    decimals: 6,
  },
};

export interface AggregatorToken {
  address: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
}

/**
 * The form to approve and route for `token` on `chainId`: the native-mirror
 * ERC20 where the token is native and the chain has one (Arc native USDC ->
 * 0x3600), else the token unchanged. The symbol is kept for display, so the user
 * still sees "USDC" while the plan approves and moves the mirror.
 */
export function aggregatorToken(
  chainId: number,
  token: {
    address: string;
    symbol: string;
    decimals: number;
    isNative?: boolean;
  },
): AggregatorToken {
  /* Some planner/tool boundaries carry the native sentinel but omit the UI-only
     `isNative` flag. Treat the canonical DEX sentinel as native too; otherwise
     Arc USDC reaches the approval resolver as 0xEeee… and its allowance call
     returns empty data. */
  const native =
    Boolean(token.isNative) ||
    token.address.toLowerCase() === NATIVE_SENTINEL.dex.toLowerCase();
  const mirror = native ? NATIVE_SWAP_ERC20[chainId] : undefined;
  return mirror
    ? {
        address: mirror.address,
        symbol: token.symbol,
        decimals: mirror.decimals,
        isNative: false,
      }
    : {
        address: token.address,
        symbol: token.symbol,
        decimals: token.decimals,
        isNative: native,
      };
}

/**
 * The meta for an aggregator's native-mirror ERC20 by address, so the auditor
 * can recognise a `0x3600` tokenIn/out that the registry deliberately does not
 * list (it would double-count native in balances). Null for any other address.
 */
export function nativeSwapErc20(
  chainId: number,
  address: string,
): { symbol: string; decimals: number } | null {
  const m = NATIVE_SWAP_ERC20[chainId];
  return m && m.address.toLowerCase() === (address || "").toLowerCase()
    ? { symbol: m.symbol, decimals: m.decimals }
    : null;
}

/** Whether `address` is the KyberSwap router the resolver would itself produce. */
export function isKnownSwapRouter(
  chainId: number | undefined,
  address: string,
): boolean {
  if (chainId === undefined) return false;
  const known = KYBERSWAP_ROUTERS[chainId];
  return Boolean(known && address && address.toLowerCase() === known.toLowerCase());
}

export interface KyberSwapExecution {
  /** The router to call and to approve — one address, so the two cannot differ. */
  to: string;
  /** KyberSwap's executable calldata. Opaque, bounded by the auditor's cap. */
  data: string;
  /** Always "0" — an ERC20 swap sends no native value. */
  value: string;
  /** The router an approve authorises; equal to `to` by construction. */
  spender: string;
  /** Expected output in the out-token's base units, for the row and the floor. */
  amountOut: string;
}

interface RouteSummary {
  [k: string]: unknown;
}

/**
 * The server-side flow: get a route, then build it WITH our fee and client id.
 * Used directly by the server planner and by the /api/swap/quote proxy; never
 * called from the browser (process.env would be empty there — the fee would go
 * uncollected). Returns null on any miss, which the caller reads as "no route".
 */
export async function resolveKyberSwap(args: {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  /** Input amount in base units. */
  amountUnits: string;
  /** The wallet — sender and recipient of the swap. */
  address: string;
  /** Slippage floor in basis points. */
  slippageBps: number;
}): Promise<KyberSwapExecution | null> {
  const slug = KYBERSWAP_CHAIN_SLUG[args.chainId];
  const router = KYBERSWAP_ROUTERS[args.chainId];
  if (!slug || !router) return null;
  const clientId = kyberClientId();

  try {
    /* Our fee rides the ROUTES query, not the build body — KyberSwap computes it
       into the route there and ignores it on build (see kyberFeeParams). */
    const routeQs = new URLSearchParams({
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountIn: args.amountUnits,
      ...kyberFeeParams(),
    });
    const routeRes = await fetch(
      `${KYBER_API}/${slug}/api/v1/routes?${routeQs}`,
      { headers: { "x-client-id": clientId }, cache: "no-store" },
    );
    if (!routeRes.ok) return null;
    const routeJson = (await routeRes.json()) as {
      data?: { routeSummary?: RouteSummary };
    };
    const routeSummary = routeJson.data?.routeSummary;
    if (!routeSummary) return null;

    const buildRes = await fetch(`${KYBER_API}/${slug}/api/v1/route/build`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": clientId },
      cache: "no-store",
      body: JSON.stringify({
        routeSummary,
        sender: args.address,
        recipient: args.address,
        slippageTolerance: args.slippageBps,
      }),
    });
    if (!buildRes.ok) return null;
    const buildJson = (await buildRes.json()) as {
      data?: { data?: string; routerAddress?: string; amountOut?: string };
    };
    const d = buildJson.data;
    if (!d?.data || !d.routerAddress || !d.amountOut) return null;

    /* Fail closed on a router we do not recognise: the auditor whitelists the
       constant above, so a build that names a different router would be refused
       there anyway — better to never carry it into a plan. */
    if (!isKnownSwapRouter(args.chainId, d.routerAddress)) return null;

    return {
      to: d.routerAddress,
      data: d.data,
      value: "0",
      spender: d.routerAddress,
      amountOut: d.amountOut,
    };
  } catch {
    return null;
  }
}

/**
 * The isomorphic entry point. On the server it resolves directly (fee + client
 * id from env); in the browser it calls /api/swap/quote, which does the same
 * server-side so the fee config never reaches the bundle.
 */
export async function getKyberSwapExecution(args: {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountUnits: string;
  address: string;
  slippageBps: number;
}): Promise<KyberSwapExecution | null> {
  if (typeof window === "undefined") return resolveKyberSwap(args);
  try {
    const qs = new URLSearchParams({
      chainId: String(args.chainId),
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountUnits: args.amountUnits,
      address: args.address,
      slippageBps: String(args.slippageBps),
    });
    const res = await fetch(`/api/swap/quote?${qs}`);
    if (!res.ok) return null;
    const body = (await res.json()) as KyberSwapExecution | { error?: string };
    if (!("to" in body) || !body.to) return null;
    return body;
  } catch {
    return null;
  }
}
