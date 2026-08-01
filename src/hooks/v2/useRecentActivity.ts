"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/supabaseClient";

export interface ActivityRow {
  wallet: string;
  activityType: string;
  tokenIn: string;
  tokenOut: string;
  amountInUsd: number;
  pointsEarned: number;
  isAgentInitiated: boolean;
  txHash: string;
  createdAt: string;
}

/** Reads the local indexer's activity log for Explore's Transactions tab. */
export function useRecentActivity(limit = 25) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("kaleido_protocol_activity")
          .select(
            "wallet, activity_type, token_in, token_out, amount_in_usd, points_earned, is_agent_initiated, tx_hash, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(limit);

        if (error) throw error;
        if (cancelled) return;
        setRows(
          (data || []).map((r) => ({
            wallet: r.wallet,
            activityType: r.activity_type,
            tokenIn: r.token_in,
            tokenOut: r.token_out,
            amountInUsd: Number(r.amount_in_usd || 0),
            pointsEarned: Number(r.points_earned || 0),
            isAgentInitiated: !!r.is_agent_initiated,
            txHash: r.tx_hash,
            createdAt: r.created_at,
          })),
        );
      } catch (err) {
        console.error("[useRecentActivity]", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return { rows, loading };
}

export default useRecentActivity;
