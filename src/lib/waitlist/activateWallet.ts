import type { SupabaseClient } from "@supabase/supabase-js";
import { hasArcActivity } from "@/lib/waitlist/arcMainnet";
import {
  eligibleTaskPoints,
  X_TASK_COLUMNS,
  type TaskRow,
} from "./eligible";
import { walletTaskVolumeUsd } from "./swapVolume";

export interface ActivationResult {
  activated: boolean;
  alreadyActive?: boolean;
  points?: number;
  error?: string;
}

/**
 * Real-time Arc activation: checks whether a wallet has transacted on Arc mainnet
 * (nonce > 0). If active on Arc, automatically writes the canonical waitlist credit
 * into `point_actions` (which triggers PostgreSQL's `materialize_point_balance` to
 * establish a Season 1 `point_balances` row) and stamps `waitlist.activated_at`.
 *
 * Idempotent: `point_actions` uses unique (chain_id, tx_hash), where tx_hash is
 * `waitlist:${wallet}`, preventing duplicate credits on repeated invocations.
 */
export async function activateWalletIfEligible(
  admin: SupabaseClient,
  rawWallet: string,
): Promise<ActivationResult> {
  const wallet = rawWallet.toLowerCase();

  // 1. Check if the wallet already has an active Season 1 balance
  const [{ data: bal }, { data: wRowData }] = await Promise.all([
    admin
      .from("point_balances")
      .select("wallet")
      .eq("wallet", wallet)
      .eq("season", 1)
      .maybeSingle(),
    admin
      .from("waitlist")
      .select("*")
      .eq("wallet", wallet)
      .maybeSingle(),
  ]);
  const wRow = wRowData as (TaskRow & { wallet: string; activated_at: string | null }) | null;

  if (bal && wRow?.activated_at) {
    return { activated: true, alreadyActive: true };
  }

  // 2. Query Arc mainnet to check for on-chain transactions (nonce > 0)
  let active = false;
  try {
    active = await hasArcActivity(wallet);
  } catch (err) {
    console.error("[activateWallet] hasArcActivity failed for", wallet, err);
    return { activated: false, error: "Arc RPC probe failed" };
  }

  if (!active) {
    return { activated: false };
  }

  // 3. Wallet has on-chain activity on Arc! Compute eligible waitlist points
  const now = new Date().toISOString();
  let points = 0;

  if (wRow) {
    let referrals = 0;
    try {
      const { data: lb } = await admin
        .from("waitlist_leaderboard")
        .select("active_referrals")
        .eq("wallet", wallet)
        .maybeSingle();
      referrals = Number(lb?.active_referrals ?? 0);
    } catch {
      /* ignore referral read failure */
    }

    let swapVolumeUsd = 0;
    try {
      swapVolumeUsd = await walletTaskVolumeUsd(admin, wallet);
    } catch {
      /* ignore swap volume read failure */
    }

    points = eligibleTaskPoints({
      row: wRow as unknown as TaskRow,
      referrals,
      swapVolumeUsd,
      now: Date.now(),
    });
  }

  // 4. Insert canonical waitlist credit into point_actions.
  // The PostgreSQL trigger `point_actions_materialize` folds this credit into `point_balances`.
  const { error: actErr } = await admin.from("point_actions").insert({
    wallet,
    source_slug: "waitlist",
    season: 1,
    tx_hash: `waitlist:${wallet}`,
    chain_id: 5042,
    usd_value: 0,
    multiplier_applied: 1.0,
    points: Math.max(0, points),
    is_agent_initiated: false,
    occurred_at: now,
  });

  if (actErr && actErr.code !== "23505") {
    console.error("[activateWallet] failed to insert point_action for", wallet, actErr);
  }

  // 5. Stamp waitlist.activated_at so the waitlist record is marked active
  if (wRow && !wRow.activated_at) {
    const { error: updErr } = await admin
      .from("waitlist")
      .update({ activated_at: now, last_checked_at: now })
      .eq("wallet", wallet)
      .is("activated_at", null);
    if (updErr) {
      console.error("[activateWallet] failed to stamp activated_at for", wallet, updErr);
    }
  }

  return { activated: true, points };
}
