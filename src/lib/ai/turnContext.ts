import { getChainMeta } from "@/constants/chains";

export type NetworkMode = "mainnet" | "testnet";

export type TurnChainStatus =
  | "not_provided"
  | "valid"
  | "unknown"
  | "mode_mismatch";

export interface TurnContextInput {
  address?: unknown;
  chainId?: unknown;
  showTestnets?: unknown;
  requestId?: unknown;
}

export interface TurnContext {
  /** Correlates one request across provider/tool logs without carrying user text. */
  requestId: string;
  /** Canonical lower-case EVM address, or undefined for a walletless turn. */
  address?: string;
  /** Validated chain only. Invalid or mode-mismatched IDs are deliberately omitted. */
  chainId?: number;
  /** The exclusive mode selected by the client; absent/invalid means mainnet. */
  networkMode: NetworkMode;
  mainnetOnly: boolean;
  chainStatus: TurnChainStatus;
  /** The raw numeric ID is retained only for a safe error message/log context. */
  requestedChainId?: number;
  chainName?: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function requestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `luca-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function validRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{1,96}$/.test(trimmed) ? trimmed : undefined;
}

/**
 * Build the only chain/mode scope a Luca turn may use.
 *
 * `chainId` is client input, so a number alone is not enough: it must exist in
 * the canonical registry and belong to the selected network mode. A mismatch is
 * an explicit error state rather than a fallback to a configured read chain.
 */
export function createTurnContext(input: TurnContextInput): TurnContext {
  const networkMode: NetworkMode = input.showTestnets === true ? "testnet" : "mainnet";
  const requestedChainId =
    typeof input.chainId === "number" && Number.isSafeInteger(input.chainId) && input.chainId > 0
      ? input.chainId
      : undefined;
  const meta = getChainMeta(requestedChainId);
  const chainStatus: TurnChainStatus =
    requestedChainId === undefined
      ? "not_provided"
      : !meta
        ? "unknown"
        : meta.network !== networkMode
          ? "mode_mismatch"
          : "valid";

  return {
    requestId: validRequestId(input.requestId) ?? requestId(),
    address:
      typeof input.address === "string" && ADDRESS.test(input.address)
        ? input.address.toLowerCase()
        : undefined,
    chainId: chainStatus === "valid" ? requestedChainId : undefined,
    networkMode,
    mainnetOnly: networkMode === "mainnet",
    chainStatus,
    ...(requestedChainId !== undefined ? { requestedChainId } : {}),
    ...(meta ? { chainName: meta.name } : {}),
  };
}

export function turnContextError(context: TurnContext): string | null {
  if (context.chainStatus === "mode_mismatch") {
    return `${context.chainName ?? `Chain ${context.requestedChainId}`} belongs to ${context.networkMode === "mainnet" ? "testnet" : "mainnet"} mode. Switch the network mode before asking Luca to read or act on it.`;
  }
  if (context.chainStatus === "unknown") {
    return `Chain ${context.requestedChainId} is not in Kaleido's chain registry, so Luca cannot safely read or act on it.`;
  }
  return null;
}
