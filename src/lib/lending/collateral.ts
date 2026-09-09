import { ethers } from "ethers";
import { providerForChain } from "@/config/provider";
import { getContracts } from "@/constants/registry";
import { registeredLendingAssets } from "@/constants/registry";
import { readContracts } from "@/lib/chain/multicall";

/**
 * Which tokens a wallet currently has deposited as collateral, read from the
 * diamond in one batched call.
 *
 * This exists because of a rule in the facet that nothing above it could see.
 * `createLendingRequest` (ProtocolFacet.sol:192) and `requestLoanFromListing`
 * (:944) both revert `Protocol__CannotBorrowCollateralAsset` when
 * `s_addressToCollateralDeposited[msg.sender][token] > 0` — you may not borrow a
 * token you are using to back a loan. A tester on 2026-09-09 deposited USDC (the
 * obvious first move, since it is what the faucet hands out) and then asked to
 * borrow USDC, in the agent and again on the Borrow page. Both built a plan and
 * both reverted at the wallet, because the rule was enforced nowhere but on
 * chain.
 *
 * Returns lowercased addresses, not balances. The question every caller asks is
 * membership — "is this token blocked" — and a balance invites the wrong fix,
 * since drawing collateral down to clear the gate is not something a wallet with
 * an open loan can safely do.
 *
 * `null`, not `[]`, when the answer is unknown: no wallet, no diamond, or a chain
 * that did not answer. Callers must not read a failed read as "nothing
 * deposited" — that is the fabricated-zero failure the multicall layer was built
 * to end, and here it would silently restore the exact bug this closes.
 *
 * Scoped to the chain's registered collateral set rather than to every token the
 * app knows: those are the only addresses `depositCollateral` accepts, so any
 * other address is zero by construction and asking about it is a wasted call.
 */
const DEPOSITS = new ethers.Interface([
  "function gets_addressToCollateralDeposited(address _sender, address _tokenAddr) view returns (uint256)",
]);

export async function readCollateralDeposits(
  chainId: number | undefined,
  address: string | undefined,
): Promise<string[] | null> {
  if (!address) return null;

  const diamond = getContracts(chainId).diamond;
  if (!diamond) return null;

  /* The union of both registered arrays, which is what `registeredLendingAssets`
     returns for the collateral side — a loanable token is depositable too, since
     addLoanableToken writes a price feed. See the helper's own header. */
  const { assets } = registeredLendingAssets(chainId, "collateral");
  if (assets.length === 0) return [];

  const results = await readContracts(
    chainId,
    assets.map((a) => ({
      target: diamond,
      iface: DEPOSITS,
      method: "gets_addressToCollateralDeposited",
      args: [address, a.address],
    })),
  );

  /* Every call failing is the chain declining to answer, which is `null` — the
     distinction the header is about. A single failed call is dropped instead:
     one unreadable asset should not turn into a claim about the other four. */
  if (results.length > 0 && results.every((r) => !r.success)) return null;

  const held: string[] = [];
  results.forEach((r, i) => {
    if (!r.success || r.value === null) return;
    try {
      if (BigInt(r.value as bigint) > 0n) held.push(assets[i].address.toLowerCase());
    } catch {
      /* Undecodable is unknown, not zero. */
    }
  });
  return held;
}

/**
 * The same question for one token, as a plain boolean with an explicit unknown.
 *
 * For the UI, which asks about the asset currently selected in a picker rather
 * than enumerating the set. `null` is "couldn't read", and the caller shows
 * nothing rather than a warning it cannot stand behind.
 */
export async function isCollateralDeposited(
  chainId: number | undefined,
  address: string | undefined,
  token: string,
): Promise<boolean | null> {
  const deposits = await readCollateralDeposits(chainId, address);
  if (!deposits) return null;
  return deposits.includes(token.toLowerCase());
}

/**
 * Providers pass `providerForChain` through `readContracts`, so this module never
 * takes a provider argument — the chain IS the argument, per the read layer's
 * rule. Re-exported for the one caller that wants to assert a chain is readable
 * before rendering a warning that depends on it.
 */
export const canReadChain = (chainId: number | undefined) =>
  Boolean(providerForChain(chainId));
