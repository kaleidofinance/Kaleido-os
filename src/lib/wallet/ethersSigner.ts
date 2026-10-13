import type { Signer } from "ethers";
import {
  getWalletSigner,
  type WalletAccountHandle,
  type WalletChainHandle,
} from "@/lib/wallet";

/**
 * The one place the write path builds an ethers signer.
 *
 * Twenty-two call sites built the signer inline; this owns that construction so
 * the provider's signing primitive is named once. It now delegates to the
 * active wallet adapter (`@/lib/wallet`), which is what a provider swap replaces
 * — the callers here do not change. The account/chain it takes are the opaque
 * handles the adapter's read hooks returned (thirdweb's own objects today);
 * callers pass them straight through.
 *
 * Throws rather than returning null when there is no connected account/chain — a
 * caller only reaches this to sign and already guards on a connected wallet, and
 * the inline `toEthers` it replaced threw on a missing account too. Callers keep
 * their own try/catch, so the throw surfaces as their existing error toast.
 */
export function toEthersSigner(
  account: WalletAccountHandle | undefined,
  chain: WalletChainHandle | undefined,
): Signer {
  return getWalletSigner(account, chain);
}
