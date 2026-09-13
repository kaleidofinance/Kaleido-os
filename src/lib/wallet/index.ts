"use client";

import { envVars } from "@/constants/envVars";
import type {
  BatchResult,
  BatchSupport,
  WalletAccountHandle,
  WalletAdapter,
  WalletChainHandle,
} from "./adapter";
import { thirdwebAdapter } from "./adapters/thirdweb";
import { dynamicAdapter } from "./adapters/dynamic";

/**
 * The one place the wallet provider is chosen.
 *
 * `NEXT_PUBLIC_WALLET_PROVIDER` names the adapter; unset (the norm) and anything
 * unrecognised resolve to thirdweb, so a typo can never leave the app with no
 * wallet layer. Every wallet primitive the app uses is re-exported from here as
 * a hook that delegates to the selected adapter — feature code and the bridge
 * hooks import from `@/lib/wallet`, never from a provider SDK, which is what
 * makes a swap a one-line change to the flag plus a new adapter file.
 */
const ADAPTERS: Record<string, WalletAdapter> = {
  thirdweb: thirdwebAdapter,
  dynamic: dynamicAdapter,
};

export const walletAdapter: WalletAdapter =
  ADAPTERS[envVars.walletProvider ?? "thirdweb"] ?? thirdwebAdapter;

/** The provider root to mount near the top of the tree. */
export const WalletRoot = walletAdapter.Root;

/** The connected address, or undefined when disconnected. */
export const useWalletAddress = (): string | undefined =>
  walletAdapter.useAddress();

/** The connected chain id, or undefined when there is no wallet/chain. */
export const useWalletChainId = (): number | undefined =>
  walletAdapter.useChainId();

/** The opaque account handle for signing, or undefined when disconnected. */
export const useWalletAccountHandle = (): WalletAccountHandle | undefined =>
  walletAdapter.useAccountHandle();

/** The opaque chain handle for signing, or undefined. */
export const useWalletChainHandle = (): WalletChainHandle | undefined =>
  walletAdapter.useChainHandle();

/** Opens the provider's connect UI. */
export const useConnectWallet = (): (() => void) => walletAdapter.useConnect();

/** Switches the wallet to a chain id; rejects if it fails or is declined. */
export const useSwitchWalletChain = (): ((chainId: number) => Promise<void>) =>
  walletAdapter.useSwitchChain();

/** Capability probe plus the atomic-batch sender. */
export const useWalletBatch = (): {
  support: BatchSupport;
  send: (calls: import("@/lib/v2/intents/batch").BatchCall[]) => Promise<BatchResult>;
} => walletAdapter.useBatch();

/**
 * The ethers signer for the connected wallet, from the handles the hooks above
 * returned. Not a hook — safe to call inside an event handler. Throws when
 * either handle is missing, which every caller already guards against.
 */
export const getWalletSigner = walletAdapter.getSigner;

export type {
  BatchResult,
  BatchSupport,
  WalletAccountHandle,
  WalletAdapter,
  WalletChainHandle,
};
