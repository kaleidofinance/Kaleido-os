import type { ReactNode } from "react";
import type { Signer } from "ethers";
import type { BatchCall } from "@/lib/v2/intents/batch";

/**
 * The wallet-provider seam.
 *
 * The app talks to *a* wallet provider through this one interface; thirdweb is
 * the only implementation today (see `adapters/thirdweb`), and swapping to
 * Dynamic, Privy or thirdweb's Ecosystem wallets is a new file implementing this
 * plus one env flag (`NEXT_PUBLIC_WALLET_PROVIDER`) — not a change to any feature
 * component. Everything provider-specific — the SDK client, the wallet list, the
 * React root, the account/chain read hooks, connect, chain-switch, the ethers
 * signer bridge and EIP-5792 batching — lives behind here.
 *
 * Why this exists now: the embedded-wallet service is a per-account subscription
 * on the provider's side, and when it lapses the app's whole sign-in breaks with
 * nothing we can fix in code. A one-file swap is the only real insurance, and
 * that is only cheap if the provider is named in exactly one place.
 *
 * ── ON HOOKS ─────────────────────────────────────────────────────────────────
 * The `use*` members ARE React hooks: an adapter implements them by calling its
 * provider's own hooks, and the app calls them through the stable `walletAdapter`
 * singleton (never conditionally), so the rules of hooks hold. The plain methods
 * (`getSigner`) are not hooks and may be called anywhere.
 */

/**
 * The provider's own account object, opaque to the app.
 *
 * Only the active adapter knows its real shape (thirdweb's `Account`, say), and
 * only the adapter interprets it — the signer bridge takes whatever the matching
 * `useAccountHandle` returned and hands it straight back to `getSigner`. Typed as
 * a distinct alias rather than `any` so a caller cannot accidentally read a field
 * off it; it is a token to pass through, nothing more.
 */
export type WalletAccountHandle = { readonly __wallet: "account" } | unknown;

/** The provider's own chain object, opaque to the app. Same contract as above. */
export type WalletChainHandle = { readonly __wallet: "chain" } | unknown;

/** Whether the connected wallet can sign several calls under one approval. */
export interface BatchSupport {
  /** True when the wallet declares atomic batching on the active chain. */
  supported: boolean;
  /** Still asking. Callers render the sequential label until this clears. */
  checking: boolean;
}

export interface BatchResult {
  /**
   * One hash per call, in call order, once the bundle confirms. An atomic
   * bundle often reports a single receipt covering every call, so this can be
   * one hash for several steps — callers must not assume a hash per step.
   */
  hashes: string[];
  /** False when the bundle landed but reverted. */
  ok: boolean;
}

export interface WalletAdapter {
  /** Stable id, for logging and the `NEXT_PUBLIC_WALLET_PROVIDER` switch. */
  readonly id: string;

  /**
   * The React root every wallet hook needs mounted above it — the provider's
   * context plus session auto-resume. Rendered once, near the top of the tree.
   */
  Root: (props: { children: ReactNode }) => ReactNode;

  /** The connected address, or undefined when no wallet is connected. */
  useAddress: () => string | undefined;

  /** The connected chain id, or undefined when there is no wallet/chain. */
  useChainId: () => number | undefined;

  /**
   * The opaque account handle to pass to `getSigner`, or undefined when
   * disconnected. Separate from `useAddress` because signing needs the live
   * object, while almost every read only needs the string.
   */
  useAccountHandle: () => WalletAccountHandle | undefined;

  /** The opaque chain handle to pass to `getSigner`, or undefined. */
  useChainHandle: () => WalletChainHandle | undefined;

  /** Opens the provider's connect UI. Dismissing it is a no-op, not an error. */
  useConnect: () => () => void;

  /**
   * Switches the wallet to `chainId`, building the chain from the app registry.
   * Rejects if the switch fails or is declined, so callers can toast and stop.
   */
  useSwitchChain: () => (chainId: number) => Promise<void>;

  /**
   * The ethers signer for the connected wallet. Synchronous — callers pass the
   * result straight into a contract, so this must not be a Promise. Takes the
   * handles the `use*` hooks returned; throws when either is missing, matching
   * the inline `toEthers` it replaced (every caller already guards on a
   * connected wallet).
   */
  getSigner: (
    account: WalletAccountHandle | undefined,
    chain: WalletChainHandle | undefined,
  ) => Signer;

  /** Capability probe plus the atomic-batch sender (EIP-5792 where supported). */
  useBatch: () => {
    support: BatchSupport;
    send: (calls: BatchCall[]) => Promise<BatchResult>;
  };
}
