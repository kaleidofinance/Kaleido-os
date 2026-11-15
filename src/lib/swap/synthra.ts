import { NATIVE_SENTINEL } from "@/constants/registry";
import {
  isSynthraExecutor,
  isSynthraInternalRouter,
} from "./synthraDeployments";

export const SYNTHRA_ELYSIUM_ROUTER =
  "0xa50ede66a573ee5bb37e28af5789b76ae5feb828";

export function isSynthraRouter(
  chainId: number | undefined,
  address: string,
): boolean {
  return (
    isSynthraInternalRouter(chainId, address) ||
    isSynthraExecutor(chainId, address)
  );
}

export interface SynthraSwapRequest {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  decimalsIn: number;
  decimalsOut: number;
  amountUnits: string;
  address: string;
  slippageBps: number;
}

export interface SynthraExternalSwapRequest {
  sourceChainId: number;
  destinationChainId: number;
  tokenIn: string;
  tokenOut: string;
  decimalsIn: number;
  decimalsOut: number;
  amountUnits: string;
  address: string;
  slippageBps: number;
}

export interface SynthraExternalExecution {
  quote: {
    quoteId: string;
    expiresAt: number;
    executionRequestId: string;
    amountOut: string;
    minimumAmountOut: string;
  };
  transaction: {
    from: string;
    to: string;
    data: string;
    value: string;
    chainId: number;
  };
  /** For an ERC-20 deposit, the provider contract the approval must authorise. */
  spender?: string;
  executionRequestId: string;
}

/** Same-chain internal Synthra swaps. External execution is handled by the
 * dedicated server-validated Synthra deposit adapter below. */
export async function getSynthraExecution(args: SynthraSwapRequest): Promise<{
  to: string;
  data: string;
  value: string;
  spender: string;
  amountOut: string;
  minimumOut: string;
} | null> {
  try {
    if (typeof window === "undefined") {
      const { inspectSynthraInternalSwap } = await import("./synthraServer");
      const result = await inspectSynthraInternalSwap({
        user: args.address,
        sourceChainId: args.chainId,
        destinationChainId: args.chainId,
        tokenIn: {
          address:
            args.tokenIn.toLowerCase() === NATIVE_SENTINEL.dex.toLowerCase()
              ? "0x0000000000000000000000000000000000000000"
              : args.tokenIn,
          decimals: args.decimalsIn,
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

/** Narrow external/cross-chain execution check. The server validator admits
 * only a single native source transaction and returns its provider request id;
 * ERC-20 and multi-step plans stay unavailable until the durable intent path
 * models their approval/resume state. */
export async function getSynthraExternalExecution(
  args: SynthraExternalSwapRequest,
): Promise<SynthraExternalExecution | null> {
  try {
    if (typeof window === "undefined") {
      const { inspectSynthraExternalSwap } = await import("./synthraServer");
      return inspectSynthraExternalSwap({
        user: args.address,
        sourceChainId: args.sourceChainId,
        destinationChainId: args.destinationChainId,
        tokenIn: { address: args.tokenIn, decimals: args.decimalsIn },
        tokenOut: { address: args.tokenOut, decimals: args.decimalsOut },
        amount: args.amountUnits,
        slippageBps: args.slippageBps,
      }).then((result) =>
        result
          ? {
              ...result,
              quote: {
                ...result.quote,
                executionRequestId: result.executionRequestId,
              },
              ...(result.spender ? { spender: result.spender } : {}),
            }
          : null,
      );
    }
    const params = new URLSearchParams({
      address: args.address,
      sourceChainId: String(args.sourceChainId),
      destinationChainId: String(args.destinationChainId),
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      decimalsIn: String(args.decimalsIn),
      decimalsOut: String(args.decimalsOut),
      amountUnits: args.amountUnits,
      slippageBps: String(args.slippageBps),
    });
    const response = await fetch(`/api/swap/synthra/external/quote?${params}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as SynthraExternalExecution;
  } catch {
    return null;
  }
}
