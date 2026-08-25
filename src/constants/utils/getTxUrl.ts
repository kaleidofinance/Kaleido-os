import { getChainMeta } from "@/constants/chains";

/**
 * A transaction on the explorer of the chain it was actually mined on.
 *
 * Returns null for a chain the registry does not carry, so the caller renders
 * plain text instead of a link. An unlinked hash is still copyable; a link to a
 * guessed explorer is not recoverable by the reader.
 *
 * This file used to also export `getTxUrl(hash)` and a chainless
 * `getAddressUrl(address)`, both hardcoded to `explorer.testnet.abs.xyz`.
 * `getTxUrl` had no callers at all. `getAddressUrl` had one — the pools table —
 * and its docstring argued the pin was safe because that table reads
 * `READ_ONLY_CHAIN_ID` and nothing else. True while that constant was 11124, and
 * false the moment it became configurable: the table would have gone on linking
 * Sepolia pool addresses to Abstract's explorer, which is a dead link that looks
 * like a live one. Both functions are chain-keyed now, which is the only shape
 * that cannot go stale this way.
 */
export function getChainTxUrl(
  chainId: number | undefined,
  hash: string,
): string | null {
  const explorer = chainId ? getChainMeta(chainId)?.blockExplorer.url : null;
  return explorer ? `${explorer.replace(/\/$/, "")}/tx/${hash}` : null;
}

/**
 * A contract or wallet on the explorer of the chain it lives on.
 *
 * Same contract as `getChainTxUrl`, including the null: an address is only
 * meaningful together with its chain, and the same twenty bytes on another chain
 * is a different contract or nothing at all.
 */
export function getChainAddressUrl(
  chainId: number | undefined,
  address: string,
): string | null {
  const explorer = chainId ? getChainMeta(chainId)?.blockExplorer.url : null;
  return explorer ? `${explorer.replace(/\/$/, "")}/address/${address}` : null;
}
