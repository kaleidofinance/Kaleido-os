import { isDeployed } from "@/constants/registry";

/**
 * Can the lending write hooks transact on this chain?
 *
 * All seven of them call this first and bail with "SWITCH NETWORK" when it is
 * false, so this predicate decides whether /borrow works at all.
 *
 * It used to be `SUPPORTED_CHAIN_ID.includes(chainId)` against a literal
 * `[11124]` — Abstract Testnet, where nothing is deployed. That made it false on
 * every chain we actually ship, so a completely successful deployment would still
 * have transacted nothing: each hook would toast "SWITCH NETWORK" and return
 * before touching a contract. It is now derived from the deploy records, so a
 * chain is supported exactly when there is a Diamond on it to call — which is the
 * thing the hooks were trying to ask in the first place.
 */
export const isSupportedChain = (chainId: number | undefined): boolean =>
  isDeployed(chainId);
