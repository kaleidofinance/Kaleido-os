import { ethers } from "ethers";
import { getERC20Contract } from "@/config/contracts";

/**
 * Bring an ERC20 allowance up to at least `needed`, or confirm it already is.
 *
 * Replaces a pattern repeated across six lending hooks that was wrong in three
 * independent ways at once:
 *
 *  1. **It compared different units.** `useCheckAllowance` returned the raw
 *     allowance (`Number(allowance)`, so 5 USDC = 5000000) and every caller
 *     tested it against the human amount (`val < Number("5")`). 5000000 < 5 is
 *     false, so an account with a 5-USDC allowance was treated as approved for
 *     any amount, and the deposit reverted inside the facet instead.
 *  2. **It read a stale value.** The allowance arrived through a `useEffect` into
 *     component state, so the number tested was whatever the last render fetched
 *     — before this transaction, and before any approve the user had just made in
 *     another tab.
 *  3. **It only knew four tokens, by Abstract-testnet address.** Anything else
 *     skipped the allowance check entirely and went straight to a transfer that
 *     could not succeed.
 *
 * This reads the allowance at call time, on the connection that is about to sign,
 * and compares base units to base units.
 *
 * Approves exactly `needed` rather than MaxUint256. Unlimited approval is a
 * standing claim on the balance that survives the transaction, and the diamond is
 * upgradeable — a facet added later inherits it. The cost is an approve per
 * top-up, which is the trade the previous code also made.
 */
export type AllowanceOutcome = "sufficient" | "approved";

export async function ensureAllowance(
  signer: ethers.Signer,
  token: string,
  owner: string,
  spender: string,
  needed: bigint,
): Promise<AllowanceOutcome> {
  if (needed <= 0n) return "sufficient";

  const erc20 = getERC20Contract(signer, token);
  const current: bigint = await erc20.allowance(owner, spender);
  if (current >= needed) return "sufficient";

  const tx = await erc20.approve(spender, needed);
  const receipt = await tx.wait();

  /* `wait()` resolves with status 0 for a mined-but-reverted approve, which is
     not an exception. Throwing converts it into one so the caller's existing
     catch reports it, instead of continuing to a transfer that cannot pull. */
  if (!receipt || receipt.status !== 1) {
    throw new Error("Token approval failed");
  }

  /* Re-read rather than assume. A token that caps or rebases the allowance it
     stores — or one that ignores approve for a non-zero existing allowance, as
     mainnet USDT does — mines a successful transaction that did not grant what
     was asked for. Better to fail here, naming the shortfall, than in the
     facet as an opaque SafeERC20FailedOperation. */
  const after: bigint = await erc20.allowance(owner, spender);
  if (after < needed) {
    throw new Error(
      `Approval did not take effect: allowance is ${after} but ${needed} is ` +
        `required. Some tokens refuse to change a non-zero allowance — reset it ` +
        `to zero and try again.`,
    );
  }

  return "approved";
}
