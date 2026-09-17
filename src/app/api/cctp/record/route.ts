import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { providerForChain } from "@/config/provider";
import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { TOKEN_MESSENGER_V2, isCctpCorridor } from "@/lib/bridge/cctp";
import { keeperArmed, TABLE_MISSING_HINT } from "@/lib/keeper/cctpKeeper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/cctp/record — register a confirmed CCTP burn for the completion
 * keeper.
 *
 * The browser records a burn in localStorage (cctpPending.ts) so its own
 * banner can offer to finish it. That is invisible to the server, and the
 * server is what completes a mint for a wallet with no gas on the
 * destination (lib/keeper/cctpKeeper.ts). So PlanReview also posts the burn
 * here, fire-and-forget, right after it confirms.
 *
 * Open to anyone, so it verifies before it writes: the transaction must exist
 * on the named source chain, have succeeded, and have been sent to
 * TokenMessengerV2 — i.e. actually be a CCTP burn. A made-up hash is refused
 * before it can occupy a row the keeper would poll. Duplicates are ignored
 * (tx_hash is unique). The recipient is recorded for the status read, never
 * used to direct the mint — the burn itself fixed that.
 */

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const AMOUNT = /^\d+(\.\d+)?$/;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status });

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const txHash = String(body.txHash ?? "");
  const sourceChainId = Number(body.sourceChainId);
  const destChainId = Number(body.destChainId);
  const recipient = String(body.recipient ?? "");
  const amount = String(body.amount ?? "").trim();
  const symbol = String(body.symbol ?? "USDC").trim();

  if (!TX_HASH.test(txHash)) return json({ error: "txHash" }, 400);
  if (!isCctpCorridor(sourceChainId, destChainId))
    return json({ error: "not a CCTP corridor" }, 400);
  if (!ethers.isAddress(recipient)) return json({ error: "recipient" }, 400);
  if (!AMOUNT.test(amount) || amount.length > 40)
    return json({ error: "amount" }, 400);
  if (symbol.toUpperCase() !== "USDC") return json({ error: "symbol" }, 400);

  if (!supabaseAdmin)
    return json({ error: "registry unavailable", keeper: false }, 503);

  /* Verify on chain before writing. */
  const provider = providerForChain(sourceChainId);
  if (!provider) return json({ error: "source chain has no RPC" }, 400);
  let receipt: ethers.TransactionReceipt | null;
  try {
    receipt = await provider.getTransactionReceipt(txHash);
  } catch {
    return json({ error: "source chain unreachable, try again" }, 503);
  }
  if (!receipt) return json({ error: "transaction not mined yet" }, 409);
  if (receipt.status !== 1) return json({ error: "transaction reverted" }, 400);
  if ((receipt.to ?? "").toLowerCase() !== TOKEN_MESSENGER_V2.toLowerCase())
    return json({ error: "not a CCTP burn" }, 400);

  const { error } = await supabaseAdmin.from("cctp_transfers").upsert(
    {
      tx_hash: txHash.toLowerCase(),
      source_chain_id: sourceChainId,
      dest_chain_id: destChainId,
      recipient: ethers.getAddress(recipient),
      amount,
      symbol: "USDC",
    },
    { onConflict: "tx_hash", ignoreDuplicates: true },
  );
  if (error) {
    const missing =
      error.code === "42P01" ||
      /relation .*cctp_transfers.* does not exist/i.test(error.message);
    console.error("[cctp/record] insert failed:", error.message);
    return json(
      { error: missing ? TABLE_MISSING_HINT : "registry write failed" },
      503,
    );
  }
  return json({ ok: true, keeper: keeperArmed() });
}
