import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { keeperArmed } from "@/lib/keeper/cctpKeeper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cctp/status?tx=<hash>,<hash>… — what the keeper has done with
 * these burns, and whether there is a keeper at all.
 *
 * Read by the browser's pending-transfer hook so its localStorage row clears
 * — with a "completed for you" — once the keeper has minted, and by PlanReview
 * before a burn, to know whether a wallet with no gas on the destination will
 * be completed for or trapped. `keeper` is true only when both a key and an
 * armed cron secret are configured, since a keeper that cannot run is no
 * keeper.
 *
 * With no `tx`, returns just `keeper`. Hashes are validated and capped; the
 * table not existing yet reads as "no rows", not an error — the browser's own
 * manual completion works regardless.
 */

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const MAX = 20;

export async function GET(request: NextRequest) {
  const keeper = keeperArmed();
  const raw = request.nextUrl.searchParams.get("tx") ?? "";
  const hashes = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => TX_HASH.test(h))
    .slice(0, MAX);

  if (hashes.length === 0 || !supabaseAdmin) {
    return NextResponse.json({ keeper, rows: [] });
  }

  const { data, error } = await supabaseAdmin
    .from("cctp_transfers")
    .select("tx_hash,status,mint_tx_hash,dest_chain_id")
    .in("tx_hash", hashes);
  if (error) {
    /* A missing table (migration not applied yet) is not the browser's problem. */
    return NextResponse.json({ keeper, rows: [] });
  }
  return NextResponse.json({
    keeper,
    rows: (data ?? []).map((r) => ({
      txHash: r.tx_hash as string,
      status: r.status as string,
      mintTxHash: (r.mint_tx_hash as string | null) ?? null,
      destChainId: r.dest_chain_id as number,
    })),
  });
}
