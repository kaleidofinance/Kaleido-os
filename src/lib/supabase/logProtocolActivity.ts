import { supabase } from "@/lib/supabase/supabaseClient"

export type ActivityType =
  | "swap"          // Manual swap via DEX UI
  | "agent_swap"    // Swap executed via Luca AI agent (gets 1.2x multiplier)
  | "add_liquidity" // Adding LP position
  | "remove_liquidity"

export interface LogActivityParams {
  wallet: string
  activityType: ActivityType
  tokenIn: string
  tokenOut: string
  /** Client-side estimate only. Never trusted as a point weight — see below. */
  amountInUsd: number
  txHash: string
  isAgentInitiated?: boolean
}

/**
 * Activity logging is disabled until the server-side ingest route exists.
 *
 * This used to compute `points_earned` in the browser and INSERT it into
 * `kaleido_protocol_activity` with the `NEXT_PUBLIC` anon key. Three things
 * were wrong with that, in increasing order of severity:
 *
 * 1. The insert's failure was swallowed into a `console.warn`. A user whose
 *    write was rejected saw a successful swap and assumed they had earned
 *    points; nothing surfaced the miss.
 * 2. `amountInUsd` was `parseFloat(amountIn)` — the raw token amount, not USD.
 *    A 1,000 USDC swap scored 1,000 and a 0.5 ETH swap scored 0.5, weighting
 *    the system against exactly the valuable assets it meant to reward.
 * 3. The browser both computed and wrote its own point balance. Whether that
 *    is mintable depends entirely on RLS on `kaleido_protocol_activity`, which
 *    has not been verified — and the anon key and project URL both ship in the
 *    client bundle, so the endpoint is reachable without going through this
 *    function at all.
 *
 * Making (1) loud would have left (2) and (3) standing. The rule the points
 * design is built on is that the client never writes points and never computes
 * them: every write is service-role, and every action point is anchored to a
 * transaction hash the server fetched and decoded itself. A client insert
 * cannot satisfy that no matter how its errors are reported, so the write is
 * gone rather than fixed.
 *
 * Nothing is lost by disabling it today: no contracts are deployed, so there is
 * no real activity to record. Existing rows are testnet-only and denominated in
 * mixed units, which is why the plan treats them as Season 0 participation
 * rather than a balance to migrate.
 *
 * Replacement (docs/points-system.md §4, §7): a server route that takes
 * `{ chainId, txHash }`, fetches the receipt, decodes the Swap/Mint log, values
 * it server-side, and writes with the service-role key. The call sites here
 * already have the receipt hash to hand it.
 *
 * The signature is kept so those call sites keep documenting what they would
 * send, and so re-enabling this is a one-file change.
 */
export async function logProtocolActivity(_params: LogActivityParams): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.info(
      "[points] Activity logging is disabled — points must be written server-side. " +
        "See logProtocolActivity.ts and docs/points-system.md §4.",
    )
  }
}

/**
 * Reads the Season 0 activity total for a wallet.
 *
 * Read-only, and public read is what the anon key is for, so this stays. But
 * the number is not a verified point balance: every row predates the ingest
 * route above, so the amounts are unverified and mis-denominated. It is a
 * record of participation.
 *
 * Phase 1 repoints this at `point_balances` — a server-computed total — at
 * which point the client-side sum in `useGetValueAndHealth` goes away too.
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
