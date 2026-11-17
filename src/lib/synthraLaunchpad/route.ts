import { NATIVE_SENTINEL } from "@/constants/registry";
import { SYNTHRA_LAUNCHPAD_CHAINS } from "./server";

export interface SynthraLaunchpadPlanResult {
  synthraLaunchpad: boolean;
  reason?: string;
  to?: string;
  data?: string;
  value?: string;
  spender?: string;
  amountOut?: string;
  minimumOut?: string;
  nativeIn?: boolean;
  nativeOut?: boolean;
  gasLimit?: string;
}

export async function getSynthraLaunchpadTradeExecution(args: {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountUnits: string;
  address: string;
  slippageBps: number;
}): Promise<import("./server").SynthraLaunchpadTradeExecution | null> {
  if (
    !SYNTHRA_LAUNCHPAD_CHAINS.includes(
      args.chainId as (typeof SYNTHRA_LAUNCHPAD_CHAINS)[number],
    )
  )
    return null;
  if (typeof window === "undefined") {
    const { resolveSynthraLaunchpadTrade } = await import("./server");
    return resolveSynthraLaunchpadTrade(args);
  }
  try {
    const response = await fetch("/api/synthra/launchpad/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const result = (await response.json()) as SynthraLaunchpadPlanResult;
    return result.synthraLaunchpad &&
      result.to &&
      result.data &&
      result.spender &&
      result.amountOut &&
      result.minimumOut
      ? {
          to: result.to,
          data: result.data,
          value: result.value ?? "0",
          spender: result.spender,
          amountOut: result.amountOut,
          minimumOut: result.minimumOut,
          nativeIn: Boolean(result.nativeIn),
          nativeOut: Boolean(result.nativeOut),
          ...(result.gasLimit ? { gasLimit: result.gasLimit } : {}),
        }
      : null;
  } catch {
    return null;
  }
}
