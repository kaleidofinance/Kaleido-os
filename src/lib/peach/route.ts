import type { Address } from "viem";

/** Peach Launchpad trades are Arc-mainnet only until Peach publishes another deployment. */
export const PEACH_CHAIN_ID = 5042;
export const PEACH_FACTORY = "0x7E462d220b6b0a4c55B205B613133dc1C1Cc9dC1" as Address;
export const PEACH_QUOTE_TOKEN = "0x3600000000000000000000000000000000000000" as Address;

export interface PeachPlanResult {
  peach: boolean;
  blocked?: boolean;
  reason?: string;
  side?: "buy" | "sell";
  tokenIn?: { address: string; symbol: string; decimals: number };
  tokenOut?: { address: string; symbol: string; decimals: number };
  spender?: string;
  to?: string;
  data?: string;
  value?: string;
  amountOut?: string;
  amountOutMinimum?: string;
  quoteToken?: string;
  quoteDecimals?: number;
  curve?: string;
}

/** Browser-safe resolver. The SDK and RPC reads stay on the server. */
export async function resolvePeachPlan(req: {
  tokenIn: string;
  tokenOut: string;
  amountInRaw: string;
  slippageBps: number;
  userAddress: string;
}): Promise<PeachPlanResult | null> {
  try {
    const res = await fetch("/api/peach/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) return { peach: false };
    return (await res.json()) as PeachPlanResult;
  } catch {
    return { peach: false };
  }
}

export async function getPeachTradeExecution(args: {
  chainId: number; tokenIn: string; tokenOut: string; amountUnits: string; address: string; slippageBps: number;
}): Promise<import("./server").PeachTradeExecution | null> {
  if (args.chainId !== PEACH_CHAIN_ID) return null;
  if (typeof window === "undefined") {
    const { resolvePeachTrade } = await import("./server");
    return resolvePeachTrade(args);
  }
  try {
    const res = await fetch("/api/peach/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...args, userAddress: args.address }) });
    if (!res.ok) return null;
    const body = await res.json() as { peach?: boolean; to?: string; data?: string; value?: string; spender?: string; amountOut?: string };
    return body.peach && body.to && body.data && body.spender ? { to: body.to, data: body.data, value: body.value ?? "0", spender: body.spender, amountOut: body.amountOut ?? "0" } : null;
  } catch { return null; }
}
