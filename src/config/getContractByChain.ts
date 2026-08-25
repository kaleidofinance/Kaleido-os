import { getContracts } from "@/constants/registry";

/**
 * The Diamond address on a chain, for use as an ERC20 approve spender.
 *
 * Every ERC20 lending write is two transactions: `approve(spender, amount)` on
 * the token, then the call on the Diamond. The spender must be the contract that
 * will pull the tokens, so this function and `getKaleidoContract` have to agree.
 * They used to read from two places that merely happened to hold the same value —
 * this one from `envVars.lendbitDiamondAddress` through a switch whose
 * `case SUPPORTED_CHAIN_ID[0]` and `default` returned the same thing, so the
 * switch decided nothing and the chain id was ignored. Both now read
 * `getContracts(chainId).diamond`, so the spender and the call target cannot
 * disagree.
 *
 * Returns undefined when the chain has no Diamond recorded, rather than a stale
 * address from some other chain: an approval granted to the wrong spender is a
 * silent failure — it succeeds, and then the Diamond call reverts on allowance
 * with nothing to indicate the approval went somewhere else. Callers check this
 * before approving.
 *
 * `getContractByChainId(signer, chainId)` used to live here too and was deleted:
 * it was the same do-nothing switch around `getKaleidoContract(signer)`, and six
 * hooks imported it without ever calling it.
 */
export const getContractAddressesByChainId = (
  chainId: number | undefined,
): string | undefined => getContracts(chainId).diamond;
