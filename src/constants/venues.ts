/**
 * External DEX venues we route THROUGH as a fallback.
 *
 * Kaleido's own V3 pools and router are always tried first — this is only for the
 * case the mainnet plan calls out: a Robinhood token a user wants to trade that we
 * have not seeded in our own pools yet. When `findBestRoute` finds nothing on our
 * deployment, the caller falls back to these venues in order, so "no route" means
 * "nowhere on this chain can fill it", not "our pools can't".
 *
 * WHY THIS IS CHEAP FOR UNISWAP V3
 *
 * Our DEX is a Uniswap V3 fork, and Uniswap V3 on Robinhood exposes the identical
 * `QuoterV2` (`quoteExactInput`/`quoteExactInputSingle`) and `SwapRouter02`
 * (`exactInput`/`exactInputSingle`) interfaces our own quoting and signing already
 * speak. So a V3 venue is just a set of addresses: the same quote code with a
 * different quoter, and the same swap calldata with a different router. No new ABI.
 *
 * WHAT IS NOT HERE YET
 *
 * Uniswap V4 (the singleton PoolManager where Pools.trade launchpad tokens live)
 * and up33 (a Uniswap-V2 DEX) are different architectures — a V4 Quoter + Universal
 * Router + Permit2, or V2 reserves + `swapExactTokensForTokens` — so they are their
 * own `kind` and their own follow-up. `kind` is the discriminant that keeps the
 * router code honest about which calldata a venue takes.
 *
 * Addresses are canonical from Uniswap's own deployment docs, verified 2026-09-12.
 */
export type VenueKind = "uniswap-v3";

export interface DexVenue {
  /** Stable id, used in logs and in the route a user reads before signing. */
  id: string;
  /** Human label for the swap card: "via Uniswap V3". */
  label: string;
  /** The discriminant the router code switches on to pick calldata shape. */
  kind: VenueKind;
  /** UniswapV3Factory — for pool existence / init-code checks. */
  factory: string;
  /** SwapRouter02 — same `exactInput`/`exactInputSingle` ABI as our own router. */
  router: string;
  /** QuoterV2 — same `quoteExactInput`/`quoteExactInputSingle` ABI as ours. */
  quoter: string;
}

const FALLBACK_VENUES: Record<number, DexVenue[]> = {
  /* Robinhood Chain mainnet (4663). Uniswap V3 is deployed here; V4 and up33 are
     separate kinds and land later. */
  4663: [
    {
      id: "uniswap-v3",
      label: "Uniswap V3",
      kind: "uniswap-v3",
      factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
      router: "0xCaf681a66D020601342297493863E78C959E5cb2",
      quoter: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
    },
  ],
};

/**
 * The fallback venues for a chain, in the order they should be tried. Empty for a
 * chain with none — every existing chain, so this changes nothing until a chain
 * (Robinhood mainnet) opts in above.
 */
export function fallbackVenues(chainId: number | undefined): DexVenue[] {
  return chainId != null ? (FALLBACK_VENUES[chainId] ?? []) : [];
}
