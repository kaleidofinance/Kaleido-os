import { supabase } from "@/lib/supabase/supabaseClient"

export type ActivityType =
  | "swap"          // Manual swap via DEX UI
  | "agent_swap"    // Swap executed via Luca AI agent (gets 1.2x multiplier)
  | "add_liquidity" // Adding LP position
  | "remove_liquidity"

interface LogActivityParams {
  wallet: string
  activityType: ActivityType
  tokenIn: string
  tokenOut: string
  amountInUsd: number   // USD value of the input — this drives the point weight
  txHash: string
  isAgentInitiated?: boolean
}

/**
 * Logs a protocol interaction to Supabase for the local indexer.
 * Points are awarded based on USD volume, not action count.
 *
 * Volume-weight formula:
 *   swap/lp     → 1 point per $1 USD
 *   agent_swap  → 1.2 points per $1 USD (20% bonus for using Luca)
 */
export async function logProtocolActivity(params: LogActivityParams): Promise<void> {
  const {
    wallet,
    activityType,
    tokenIn,
    tokenOut,
    amountInUsd,
    txHash,
    isAgentInitiated = false,
  } = params

  // Calculate the point value for this action
  const basePoints = Math.floor(amountInUsd) // $1 = 1 point
  const multiplier = isAgentInitiated || activityType === "agent_swap" ? 1.2 : 1.0
  const pointsEarned = Math.floor(basePoints * multiplier)

  try {
    const { error } = await supabase.from("kaleido_protocol_activity").insert({
      wallet: wallet.toLowerCase(),
      activity_type: activityType,
      token_in: tokenIn,
      token_out: tokenOut,
      amount_in_usd: amountInUsd,
      points_earned: pointsEarned,
      is_agent_initiated: isAgentInitiated,
      tx_hash: txHash,
      created_at: new Date().toISOString(),
    })

    if (error) {
      console.warn("⚠️ Failed to log protocol activity:", error.message)
    } else {
      console.log(`📝 Activity Logged: ${activityType} | $${amountInUsd} | +${pointsEarned} pts${isAgentInitiated ? " (Luca 1.2x)" : ""}`)
    }
  } catch (e) {
    // Non-blocking — never throw, activity logging should never break a swap
    console.warn("⚠️ logProtocolActivity exception:", e)
  }
}

/**
 * Fetches the total volume-weighted points for a wallet from the local indexer.
 * Called by the Point System aggregator in useGetValueAndHealth.
 */
export async function getActivityPoints(wallet: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("kaleido_protocol_activity")
      .select("points_earned")
      .eq("wallet", wallet.toLowerCase())

    if (error || !data) return 0

    return data.reduce((sum, row) => sum + (row.points_earned || 0), 0)
  } catch (e) {
    return 0
  }
}
