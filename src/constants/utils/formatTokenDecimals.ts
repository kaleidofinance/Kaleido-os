import { declaredDecimals, isNativeSentinel } from "@/constants/registry";
import { ethers } from "ethers";

/**
 * Declared decimals for a token, on a given chain — the LENIENT answer.
 *
 * It used to take an address alone and branch on two Abstract-testnet literals:
 * `ADDRESS_1` or `kfUSD_ADDRESS` meant 18, and *everything else* meant 6. Both
 * halves broke once the protocol deployed to five real chains. kfUSD has a
 * different address on each of them, so the 18 branch never matched and kfUSD —
 * an 18-decimal token — formatted at 6, overstating every kfUSD figure by 1e12.
 * And the `return 6` caught every newly deployed address, which is exactly what
 * rule 2 in constants/registry.ts warns about: decimals are declared data, and
 * "USDC means 6" is wrong on Arc, whose native currency is USDC at 18 decimals.
 *
 * The lookup itself now lives in one place, `declaredDecimals` in the registry,
 * which answers from the native sentinel, the declared TOKENS table, our own
 * deployed tokens and the lending currency list — and returns `undefined` when
 * none of them knows the token. This function is the display wrapper around it:
 * it substitutes a number so a label never renders NaN.
 *
 * Two fallbacks live here, and they are not the same kind of thing:
 *
 *  - **18 for a sentinel with no chain.** A fact, not a guess: every chain in
 *    chains.ts has 18 native decimals, Arc's 18-decimal USDC included. Only
 *    reachable when the caller has no chainId at all.
 *  - **`?? 6` for anything else.** A guess, kept deliberately and reluctantly —
 *    it is the pre-existing behaviour and every caller feeds the result straight
 *    into `ethers.formatUnits`. Rule 2 says a guess is wrong, so anything about
 *    to build a TRANSACTION amount must call `declaredDecimals` directly and
 *    refuse on `undefined`. The write paths in src/hooks/v2 and src/lib/lending
 *    do exactly that, and `describeToken` in lib/v2/intents/build.ts — which
 *    this docstring used to flag as the one exception — now does too: it returns
 *    null and the plan is refused, because its two callers put the formatted
 *    amount in the sentence the user confirms before signing.
 *
 * So every remaining caller is a label, with ONE exception that is safe for a
 * reason worth stating before you touch either half of it:
 * `useGetActiveRequest.ts:54` formats `totalRepayment` with this, and
 * `useBorrowV2.ts:201` parseUnits() that same string back with this, on the same
 * chainId, to build the repay transaction. `parseUnits(formatUnits(raw, d), d)`
 * returns `raw` for ANY `d`, so the amount signed is exact even if the `?? 6`
 * fired — the two wrongs cancel. What does not cancel is the string in between,
 * which is also what the user reads: a 6 against an 18-decimal token shows a
 * repayment 1e12 too large. Moving ONE side to `declaredDecimals` breaks the
 * cancellation and starts rescaling real repayments, so move both or neither.
 *
 * If you are adding a caller that is neither a label nor one half of a symmetric
 * round trip, call `declaredDecimals` instead of widening this.
 */
export const getTokenDecimals = (
  chainId: number | undefined,
  tokenAddress: string,
): number => {
  if (!tokenAddress) return 6;

  const declared = declaredDecimals(chainId, tokenAddress);
  if (declared !== undefined) return declared;

  if (
    isNativeSentinel(tokenAddress, "lending") ||
    isNativeSentinel(tokenAddress, "dex")
  ) {
    return 18;
  }

  return 6;
};

export const correctFormattedAmount = (
  chainId: number | undefined,
  amount: string,
  tokenAddress: string,
): string => {
  const decimals = getTokenDecimals(chainId, tokenAddress);

  // Reconvert to raw wei (multiply by 10^18)
  const rawAmount = BigInt(amount);

  // Reformat with correct decimals (e.g., 6 for USDC)
  const formatted = ethers.formatUnits(rawAmount, decimals);
  return Number(formatted).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
};
