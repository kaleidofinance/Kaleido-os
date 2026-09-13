import type { WalletAdapter } from "../adapter";

/**
 * A placeholder Dynamic (dynamic.xyz) adapter — the seam, not an implementation.
 *
 * It exists so the interface has a second implementor the compiler checks, and
 * so the shape of the work is written down in one place: to move the app off
 * thirdweb, fill each member below with Dynamic's SDK and set
 * `NEXT_PUBLIC_WALLET_PROVIDER=dynamic`. Nothing else in the app changes — the
 * feature components and the bridge hooks already talk only to {@link WalletAdapter}.
 *
 * Why Dynamic is the sketched option: it supports **private-key export**, so
 * users are not locked to the provider the way an embedded-wallet subscription
 * locks them today (the failure that prompted this whole seam). Privy and
 * thirdweb's own Ecosystem wallets would each be a sibling of this file.
 *
 * Every member throws until implemented, so selecting this provider without
 * wiring it fails loudly at the first wallet interaction rather than silently
 * rendering a dead connect button.
 *
 * A real implementation must provide:
 *  - Root:            <DynamicContextProvider> configured with the env id +
 *                     the EVM networks from the app registry, plus session
 *                     auto-resume, wrapping children.
 *  - useAddress /     the connected primary wallet's address and chain id, read
 *    useChainId:      from Dynamic's context hooks.
 *  - useAccountHandle the Dynamic wallet/connector object `getSigner` needs, and
 *    / useChainHandle: the active network descriptor.
 *  - useConnect:      open Dynamic's auth flow (setShowAuthFlow).
 *  - useSwitchChain:  Dynamic's network switch, building the target from the
 *                     app registry (see toThirdwebChainOptions for the fields).
 *  - getSigner:       an ethers v6 Signer from the Dynamic connector
 *                     (getSigner()/getWalletClient → BrowserProvider).
 *  - useBatch:        EIP-5792 via Dynamic where the wallet supports it; a
 *                     { supported:false } probe is a valid stopgap — callers
 *                     already fall back to sequential sends.
 */
const notWired = (member: string): never => {
  throw new Error(
    `Wallet provider "dynamic" is selected but not implemented (${member}). ` +
      "Implement src/lib/wallet/adapters/dynamic.ts or set " +
      "NEXT_PUBLIC_WALLET_PROVIDER=thirdweb.",
  );
};

export const dynamicAdapter: WalletAdapter = {
  id: "dynamic",
  Root: () => notWired("Root"),
  useAddress: () => notWired("useAddress"),
  useChainId: () => notWired("useChainId"),
  useAccountHandle: () => notWired("useAccountHandle"),
  useChainHandle: () => notWired("useChainHandle"),
  useConnect: () => notWired("useConnect"),
  useSwitchChain: () => notWired("useSwitchChain"),
  getSigner: () => notWired("getSigner"),
  useBatch: () => notWired("useBatch"),
};
