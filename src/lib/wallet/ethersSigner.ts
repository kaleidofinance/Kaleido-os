import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";

type ToEthersArgs = Parameters<typeof ethers6Adapter.signer.toEthers>[0];
type SignerReturn = ReturnType<typeof ethers6Adapter.signer.toEthers>;

/**
 * The one place the thirdweb→ethers signing bridge lives.
 *
 * Twenty-two call sites built the writing signer inline with
 * `ethers6Adapter.signer.toEthers({ client, chain, account })` — the same three
 * arguments every time, the `client` wiring repeated at each. This owns that
 * construction, so `ethers6Adapter` (and `client`, for signing) is imported in
 * ONE module. When the wallet provider changes, the signer bridge is rewritten
 * here rather than at every write hook — the last piece of the wallet
 * abstraction: reads went through `useWalletV2` (PR-2) and the switch/connect
 * gate through `useChainAction` (PR-1); the batched sender already lives in
 * `useBatchCalls`. After this, the provider's signing primitives are named in
 * two files, not twenty-four.
 *
 * Throws rather than returning null when there is no connected account/chain. A
 * caller only reaches this to sign, and every one already guards on a connected
 * wallet first; the inline `toEthers` it replaces threw on a missing account
 * too. Callers keep their own try/catch, so the throw surfaces as their existing
 * error toast rather than a new code path.
 */
export function toEthersSigner(
  account: ToEthersArgs["account"] | undefined,
  chain: ToEthersArgs["chain"] | undefined,
): SignerReturn {
  if (!account || !chain) {
    throw new Error("Wallet not connected — no signer available.");
  }
  return ethers6Adapter.signer.toEthers({ client, chain, account });
}
