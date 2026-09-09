import { ethers } from "ethers";
import { providerForChain } from "@/config/provider";
import { stakingContracts } from "@/constants/registry";

/**
 * Where a wallet is in the vault's unstake lifecycle, read from the chain the
 * wallet is on.
 *
 * Unstaking stKLD is not one call. KLDVaultV2 stores a per-account cooldown:
 * `requestWithdrawal()` starts it, `withdraw(token, amount)` only succeeds once
 * it has elapsed, and `cancelWithdrawalRequest()` abandons it. So "unstake" as a
 * user says it names one of three transactions depending on state the sentence
 * cannot carry — which is why the grammar refused an unstake verb for as long as
 * it did, and why the planner reads this before choosing a step rather than
 * guessing. Shared by the browser planner and the server one for the same reason
 * `readPoolState` is: the two must agree about which step a wallet is on.
 *
 * `null` means the state could not be read — no vault on this chain, no wallet,
 * or the RPC did not answer — and every caller refuses on it rather than
 * defaulting to "no request", which would send a second request at a vault that
 * already holds one.
 */
export interface StakingState {
  /** True while a withdrawal request is open — requested, not yet withdrawn. */
  hasRequest: boolean;
  /** Seconds until an open request unlocks; 0 once claimable or when none is open. */
  timeLeft: number;
}

const VAULT_READ_ABI = [
  "function hasWithdrawalRequest(address _user) view returns (bool)",
  "function getWithdrawalTimeLeft(address _user) view returns (uint256)",
];

export async function readStakingState(
  chainId: number | undefined,
  address: string | undefined,
): Promise<StakingState | null> {
  if (!address) return null;
  const staking = stakingContracts(chainId);
  const provider = providerForChain(chainId);
  if (!staking.supported || !staking.kldVault || !provider) return null;
  try {
    const vault = new ethers.Contract(staking.kldVault, VAULT_READ_ABI, provider);
    const [hasRequest, timeLeft] = await Promise.all([
      vault.hasWithdrawalRequest(address),
      vault.getWithdrawalTimeLeft(address),
    ]);
    return {
      hasRequest: Boolean(hasRequest),
      timeLeft: Math.max(0, Number(timeLeft)),
    };
  } catch {
    return null;
  }
}
