import type { SupabaseClient } from "@supabase/supabase-js";
import type { Season1Balance } from "./status";

export interface RewardFacts {
  row: Record<string, unknown>;
  referral: {
    referrals: number;
    active_referrals: number;
    pending_referrals: number;
    rank: number;
  } | null;
  volume: {
    swaps_usd: number | string;
    collateral_usd: number | string;
  } | null;
  taskCounts: Record<string, number>;
  season1: Season1Balance | null;
  asOf: string;
}

/** One indexed, read-only RPC. Never replace a failed read with zero progress. */
export async function readRewardFacts(
  admin: SupabaseClient,
  wallet: string,
): Promise<RewardFacts | null> {
  const { data, error } = await admin
    .rpc("reward_wallet_facts", { p_wallet: wallet })
    .abortSignal(AbortSignal.timeout(8_000));
  if (error) throw new Error("Could not read rewards", { cause: error });
  return data as RewardFacts | null;
}
