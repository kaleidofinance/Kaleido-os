import { defineChain, type Chain } from "thirdweb/chains";
import { getChainMeta, toThirdwebChainOptions } from "@/constants/chains";

/**
 * Rebuild a thirdweb chain from Kaleido's registry before creating a signer.
 *
 * `useActiveWalletChain()` can return the provider's metadata object rather
 * than the object we passed to `switchChain`. For an unrecognised chain that is
 * harmless, but for a registered chain it can silently replace our RPC with
 * thirdweb's hosted `https://<id>.rpc.thirdweb.com/<client>` endpoint. That
 * makes ethers reads (and receipt waits) fail even when the chain's configured
 * RPC is healthy. The chain id is the stable identity; the registry owns the
 * transport.
 */
export function canonicalThirdwebChain(chain: Chain): Chain {
  const id = Number(chain.id);
  const meta = Number.isInteger(id) ? getChainMeta(id) : undefined;
  return meta ? defineChain(toThirdwebChainOptions(meta)) : chain;
}
