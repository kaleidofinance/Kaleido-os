import { ELYSIUM_CHAIN_ID } from "./addresses";
import type { ElysiumTradeExecution } from "./server";

export { ELYSIUM_CHAIN_ID };

/**
 * Isomorphic Elysium Launchpad trade resolver.
 * - On the server (`serverPlanDeps`), calls `resolveElysiumTrade` directly.
 * - In the browser (`useLocalPlanner`), proxies through `POST /api/elysium/plan`.
 */
export async function getElysiumTradeExecution(args: {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountUnits: string;
  address: string;
  slippageBps: number;
}): Promise<ElysiumTradeExecution | null> {
  if (args.chainId !== ELYSIUM_CHAIN_ID) return null;
  if (typeof window === "undefined") {
    const { resolveElysiumTrade } = await import("./server");
    return resolveElysiumTrade(args);
  }
  try {
    const res = await fetch("/api/elysium/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      elysium?: boolean;
      to?: string;
      data?: string;
      value?: string;
      spender?: string;
      amountOut?: string;
      launchpad?: string;
      launchpadLabel?: string;
    };
    return body.elysium && body.to && body.data && body.spender
      ? {
          to: body.to,
          data: body.data,
          value: body.value ?? "0",
          spender: body.spender,
          amountOut: body.amountOut ?? "0",
          launchpad: body.launchpad,
          launchpadLabel: body.launchpadLabel,
        }
      : null;
  } catch {
    return null;
  }
}
