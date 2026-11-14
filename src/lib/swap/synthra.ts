import { NATIVE_SENTINEL } from "@/constants/registry";

export const SYNTHRA_ELYSIUM_ROUTER =
  "0xa50ede66a573ee5bb37e28af5789b76ae5feb828";

export function isSynthraRouter(
  chainId: number | undefined,
  address: string,
): boolean {
  return chainId === 99901 && address.toLowerCase() === SYNTHRA_ELYSIUM_ROUTER;
}

export interface SynthraSwapRequest {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  decimalsOut: number;
  amountUnits: string;
  address: string;
  slippageBps: number;
}

/** Only native HYPE internal swaps are supported by the initial audited adapter. */
export async function getSynthraExecution(args: SynthraSwapRequest): Promise<{
  to: string;
  data: string;
  value: string;
  spender: string;
  amountOut: string;
  minimumOut: string;
} | null> {
  if (
    args.chainId !== 99901 ||
    args.tokenIn.toLowerCase() !== NATIVE_SENTINEL.dex.toLowerCase()
  )
    return null;
  try {
    if (typeof window === "undefined") {
      const { inspectSynthraInternalHypeSwap } = await import(
        "./synthraServer"
      );
      const result = await inspectSynthraInternalHypeSwap({
        user: args.address,
        sourceChainId: 99901,
        destinationChainId: 99901,
        tokenIn: {
          address: "0x0000000000000000000000000000000000000000",
          decimals: 18,
          symbol: "HYPE",
        },
        tokenOut: { address: args.tokenOut, decimals: args.decimalsOut },
        amount: args.amountUnits,
        slippageBps: args.slippageBps,
      });
      return result ? { ...result, spender: result.to } : null;
    }
    const params = new URLSearchParams(
      Object.entries(args).map(([key, value]) => [key, String(value)]),
    );
    const response = await fetch(`/api/swap/synthra/quote?${params}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const result = await response.json();
    return result && isSynthraRouter(args.chainId, result.to ?? "")
      ? result
      : null;
  } catch {
    return null;
  }
}
