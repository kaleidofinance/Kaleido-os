import { getContracts, registeredLendingAssets } from "@/constants/registry";

/** Arc mainnet. */
export const ARC_MAINNET = 5042;

/**
 * Whether the Arc MAINNET lending book is live, and on which assets — read from the
 * generated registry (a diamond on 5042 + its registered collateral / loanable),
 * never written by hand. Everything that tells a user what is available on Arc
 * (Luca's product facts, the capability help) reads this, so it flips in the same
 * deploy that publishes the diamond to the app, and names exactly the assets the
 * contract accepts.
 */
export interface ArcLending {
  collateral: string[];
  loanable: string[];
}

export function arcLending(): ArcLending | null {
  if (!getContracts(ARC_MAINNET).diamond) return null;
  const collateral = registeredLendingAssets(ARC_MAINNET, "collateral").assets.map((a) => a.symbol);
  const loanable = registeredLendingAssets(ARC_MAINNET, "loanable").assets.map((a) => a.symbol);
  return collateral.length && loanable.length ? { collateral, loanable } : null;
}
