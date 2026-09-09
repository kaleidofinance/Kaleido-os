import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";
import { getContracts } from "@/constants/registry";
import { readMakerOrders } from "@/lib/dex/orderStore";
import {
  orderHash,
  recoverMaker,
  type SignedOrder,
} from "@/lib/dex/orders";

/**
 * The off-chain half of /trade/limit.
 *
 * A signed order is useless to anyone who cannot see it: KaleidoOrders holds no
 * order book, by design — it holds signatures' consequences, not the signatures.
 * So this route is the delivery mechanism between a maker's wallet and the keeper
 * that fills them. It is not the authority for anything. The chain answers "is
 * this fillable" via `checkFill`, "how many times has it filled" via
 * `stateOf(hash)`, and "is it cancelled" via `epochOf(maker)` plus the order's
 * own cancelled flag.
 *
 * WHY THERE IS NO DELETE OR PATCH HERE.
 * Deleting a row does not cancel an order — the signature is still valid and
 * anyone who kept a copy can still fill it. Cancellation is a transaction, so the
 * UI sends one. Exposing a write that marks an order cancelled would be a
 * primitive for taking someone else's order out of the book without their
 * signature, and it would still not stop the fill. The keeper reconciles status
 * with the service role, straight to Supabase.
 *
 * WHY POST REVERIFIES EVERYTHING.
 * The digest is recomputed from the fields rather than taken from the client — a
 * client-supplied hash is a client-supplied primary key — and the contract
 * address is read from the generated registry rather than from the request, so a
 * row cannot claim to belong to a contract that isn't ours. What the signature
 * check buys is narrow but real: without it, anyone holding the anon key out of
 * the bundle could fill the table with unfillable orders in other people's names
 * and bury the ones that can fill.
 */

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ GET -- */

/**
 * A maker's orders on one chain, newest first.
 *
 * Filtered server-side rather than fetched whole. The book is public — that is
 * what makes it fillable by anyone — but the list on /trade/limit only ever shows
 * one wallet's own orders, and shipping every visitor the whole table to filter
 * in the browser is a different thing from being public.
 *
 * The query itself lives in dex/orderStore.ts, because the agent's planner reads
 * the same rows and neither caller should own the row→StoredOrder mapping. That
 * module reads through the anon client, which the table's SELECT policy allows.
 * No service role: a read path that needs the service role is a read path that
 * can be turned into a write path by a later edit.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const maker = searchParams.get("maker")?.trim() ?? "";
  const chainId = Number(searchParams.get("chainId"));

  if (!ethers.isAddress(maker)) {
    return NextResponse.json(
      { error: "A wallet address is required." },
      { status: 400 },
    );
  }
  if (!Number.isInteger(chainId) || chainId <= 0) {
    return NextResponse.json({ error: "A chain id is required." }, { status: 400 });
  }

  try {
    const orders = await readMakerOrders(maker, chainId);
    return NextResponse.json({ orders });
  } catch (e) {
    console.error("orders GET failed:", e);
    return NextResponse.json(
      { error: "Couldn't load orders." },
      { status: 500 },
    );
  }
}

/* ----------------------------------------------------------------- POST -- */

/**
 * The fields the request must carry, checked one at a time.
 *
 * Every rule here is one of KaleidoOrders' `_shapeValid` lines, and they are
 * repeated rather than deferred to the chain for one reason: the chain refuses a
 * malformed order at fill time, which is after the wallet prompt and after the
 * row is stored. The order then sits in the list looking pending forever. The app
 * layer's `buildOrder` applies the same rules; this is the copy that also has to
 * hold against a request that never went through it.
 *
 * Returns a sentence, because the client shows it unchanged.
 *
 * One line here is stricter than the contract: an interval on a one-time order is
 * refused rather than ignored. `_shapeValid` permits it, and it is harmless —
 * after a single fill the order is spent, so the interval is never read — but it
 * is also unmeaning, and a shape the store admits is a shape the keeper has to
 * reason about. The migration's check constraint draws the same line.
 */
function badOrder(o: unknown): string | null {
  if (!o || typeof o !== "object") return "The order is missing.";
  const r = o as Record<string, unknown>;

  const isAddr = (v: unknown) => typeof v === "string" && ethers.isAddress(v);
  /* Decimal strings, not numbers. A uint256 that arrives as a JSON number has
     already been rounded by the parser if it exceeds 2^53, and a rounded minOut
     or salt re-hashes to a different digest — an order that stores fine and can
     never fill. */
  const isUint = (v: unknown) => typeof v === "string" && /^[0-9]+$/.test(v);
  const isNum = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;

  if (!isAddr(r.maker)) return "The order names no maker.";
  if (!isAddr(r.tokenIn) || !isAddr(r.tokenOut)) return "The order names no pair.";
  if (
    ethers.getAddress(r.tokenIn as string) === ethers.getAddress(r.tokenOut as string)
  ) {
    return "An order has to be between two different tokens.";
  }
  if (!isUint(r.amountIn) || r.amountIn === "0") {
    return "The order has no amount. Amounts must be decimal strings in base units.";
  }
  if (!isUint(r.minOut) || r.minOut === "0") {
    return "The order has no floor. A zero floor would let whoever fills it choose the price.";
  }
  if (!isUint(r.salt)) return "The order has no salt.";
  if (!isNum(r.startAt) || !isNum(r.expiry)) return "The order has no window.";
  if ((r.expiry as number) <= (r.startAt as number)) {
    return "The order expires before it starts.";
  }
  if (!isNum(r.interval)) return "The order's interval is not a whole number of seconds.";
  if (!isNum(r.maxFills) || (r.maxFills as number) < 1) {
    return "The order has no fill count.";
  }
  if ((r.maxFills as number) > 1 && (r.interval as number) === 0) {
    return "A recurring order needs a gap between fills.";
  }
  if ((r.maxFills as number) === 1 && (r.interval as number) !== 0) {
    return "A one-time order can't have an interval.";
  }
  if (!isNum(r.epoch)) return "The order carries no cancellation epoch.";

  /* Already dead on arrival. Not a shape error — a perfectly formed order can be
     posted a second too late — but storing one means the keeper reads it once per
     cycle forever to conclude nothing. */
  const now = Math.floor(Date.now() / 1000);
  if ((r.expiry as number) <= now) return "That order has already expired.";

  return null;
}

export async function POST(request: NextRequest) {
  if (!isAdminConfigured || !supabaseAdmin) {
    /* Loud rather than silent. Unlike activity logging, which is allowed to fail
       quietly because a swap still happened, an order that was signed and not
       stored is an order nobody will fill — and the user believes it is live. */
    console.error("orders POST: SUPABASE_SERVICE_ROLE_KEY is not configured.");
    return NextResponse.json(
      { error: "Orders aren't being accepted right now. Nothing has moved." },
      { status: 503 },
    );
  }

  let body: SignedOrder;
  try {
    body = (await request.json()) as SignedOrder;
  } catch {
    return NextResponse.json({ error: "That isn't valid JSON." }, { status: 400 });
  }

  const chainId = Number(body?.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    return NextResponse.json({ error: "A chain id is required." }, { status: 400 });
  }

  /* The verifying contract comes from the registry, never from the request. It is
     part of the EIP-712 digest, so accepting the client's value would let a row
     claim to belong to a contract we never deployed — and the keeper, which reads
     the address from the same registry, would then compute a different digest and
     find every signature invalid. */
  const registryOrders = getContracts(chainId).orders;
  if (!registryOrders) {
    return NextResponse.json(
      { error: "Limit orders aren't live on this network yet." },
      { status: 400 },
    );
  }
  if (
    body?.orders &&
    ethers.isAddress(body.orders) &&
    ethers.getAddress(body.orders) !== ethers.getAddress(registryOrders)
  ) {
    /* Almost always a stale tab after a redeploy, and worth its own message: the
       signature is real, it is simply over a contract that is no longer the one
       the app uses. Nothing can make it fillable, so the user has to sign again. */
    return NextResponse.json(
      {
        error:
          "That order was signed against a different orders contract. Reload the page and place it again.",
      },
      { status: 409 },
    );
  }

  const shapeError = badOrder(body?.order);
  if (shapeError) {
    return NextResponse.json({ error: shapeError }, { status: 400 });
  }
  if (typeof body?.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.signature)) {
    return NextResponse.json({ error: "The signature is missing." }, { status: 400 });
  }

  const order = body.order;
  const signed: SignedOrder = {
    order,
    signature: body.signature,
    chainId,
    orders: ethers.getAddress(registryOrders),
    /* Recomputed, not read. This is the primary key and the contract's own state
       key, so it has to be derived from the fields being stored. */
    hash: orderHash(order, chainId, registryOrders),
  };

  /* Three answers, and the third is why this is not a simple boolean. A contract
     wallet's ERC-1271 signature is not recoverable ECDSA at all, so "could not
     recover" is not "forged" — and in-app email and social logins are smart
     accounts. Those are stored flagged; the keeper's `checkFill` settles them
     against the chain, which is the only thing that can. */
  const verdict = recoverMaker(signed);
  if (verdict.ok === false && "reason" in verdict) {
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }
  const sigUnverified = verdict.ok === false;

  const row = {
    order_hash: signed.hash,
    chain_id: chainId,
    orders: signed.orders,
    /* Lowercased for the index; `order_json` keeps whatever casing was signed,
       since that is the object the digest was computed over and the one handed
       back to `fill`. */
    maker: order.maker.toLowerCase(),
    token_in: ethers.getAddress(order.tokenIn),
    token_out: ethers.getAddress(order.tokenOut),
    amount_in: order.amountIn,
    min_out: order.minOut,
    start_at: order.startAt,
    expiry: order.expiry,
    interval_secs: order.interval,
    max_fills: order.maxFills,
    epoch: order.epoch,
    salt: order.salt,
    signature: signed.signature,
    sig_unverified: sigUnverified,
    order_json: order,
    status: "open" as const,
  };

  /* Upsert on the digest rather than insert. Two posts of the same signed order
     are the same order — the digest is the contract's state key, so a second row
     would not double it, it would only make the list show it twice. A retry after
     a dropped response is the normal way this happens. */
  const { error } = await supabaseAdmin
    .from("kaleido_limit_orders")
    .upsert(row, { onConflict: "order_hash" });

  if (error) {
    console.error("orders POST failed:", error);
    return NextResponse.json(
      {
        error:
          "Your order was signed but couldn't be stored. Nothing has moved — the order just isn't visible to anyone who could fill it yet.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ hash: signed.hash, sigUnverified });
}
