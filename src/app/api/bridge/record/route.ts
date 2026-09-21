import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { providerForChain } from "@/config/provider";
import { isKnownBridgeAddress, isKnownBridgeSpender } from "@/lib/bridge/route";
import { getPrices } from "@/lib/points/prices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/bridge/record — log a confirmed aggregator-route (LI.FI) bridge so
 * its volume and our integrator fee reach the pool page's platform totals.
 *
 * PlanReview posts this fire-and-forget when a `provider:"lifi"` bridge confirms
 * (CCTP bridges take their own cctp_transfers path). It is a headline metric, not
 * points, but it still verifies on chain before writing so a made-up hash cannot
 * inflate the number: the tx must exist on the source chain, have succeeded, be
 * sent BY the wallet, and go TO a known bridge router. The notional is priced
 * here (lib/points/prices) rather than trusted from the client. The one thing not
 * re-derived is the amount itself — parsing it from arbitrary LI.FI calldata is
 * route-specific — so a real bridge could be logged with an inflated amount;
 * bounded (a real gas-paying bridge per row) and it only moves a vanity total.
 */

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^\d+(\.\d+)?$/;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  let body: {
    txHash?: unknown;
    sourceChainId?: unknown;
    wallet?: unknown;
    amount?: unknown;
    symbol?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const txHash = String(body.txHash ?? "").trim();
  const wallet = String(body.wallet ?? "").trim().toLowerCase();
  const amount = String(body.amount ?? "").trim();
  const symbol = String(body.symbol ?? "").trim();
  const sourceChainId = Number(body.sourceChainId);

  if (!TX_HASH.test(txHash)) return json({ error: "txHash" }, 400);
  if (!ADDRESS.test(wallet)) return json({ error: "wallet" }, 400);
  if (!AMOUNT.test(amount) || amount.length > 40) return json({ error: "amount" }, 400);
  if (!symbol || symbol.length > 16) return json({ error: "symbol" }, 400);
  if (!Number.isInteger(sourceChainId)) return json({ error: "sourceChainId" }, 400);

  const provider = providerForChain(sourceChainId);
  if (!provider) return json({ error: "unsupported chain" }, 400);

  // On-chain proof: a real, successful bridge from this wallet to a known router.
  let receipt: ethers.TransactionReceipt | null;
  let tx: ethers.TransactionResponse | null;
  try {
    [receipt, tx] = await Promise.all([
      provider.getTransactionReceipt(txHash),
      provider.getTransaction(txHash),
    ]);
  } catch {
    return json({ error: "rpc" }, 502);
  }
  if (!receipt || !tx) return json({ error: "tx not found" }, 404);
  if (receipt.status !== 1) return json({ error: "tx did not succeed" }, 422);
  if ((tx.from ?? "").toLowerCase() !== wallet)
    return json({ error: "tx not from wallet" }, 422);
  const to = receipt.to ?? tx.to ?? "";
  if (!isKnownBridgeSpender(to) && !isKnownBridgeAddress(sourceChainId, to))
    return json({ error: "not a known bridge router" }, 422);

  // Price the notional the same way points value a swap — server-side, never the
  // client's number. Unpriceable assets store null and are excluded from sums.
  let usdValue: number | null = null;
  try {
    const priced = (await getPrices([symbol])).get(symbol)?.usd ?? null;
    if (priced != null && Number.isFinite(priced)) {
      const n = Number(amount) * priced;
      if (Number.isFinite(n) && n >= 0) usdValue = n;
    }
  } catch {
    /* No price is not an error — the row is kept, just uncounted in USD. */
  }

  if (!supabaseAdmin) return json({ ok: true, stored: false });
  const { error } = await supabaseAdmin.from("route_bridges").upsert(
    {
      tx_hash: txHash,
      source_chain_id: sourceChainId,
      wallet,
      amount,
      symbol,
      usd_value: usdValue,
      provider: "lifi",
    },
    { onConflict: "tx_hash", ignoreDuplicates: true },
  );
  if (error) {
    // A missing table (migration not applied yet) must not surface to the user.
    console.error("[bridge/record] insert failed:", error.message);
    return json({ ok: true, stored: false });
  }
  return json({ ok: true, stored: true, usdValue });
}
