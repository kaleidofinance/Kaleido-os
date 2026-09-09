import { supabase } from "@/lib/supabase/supabaseClient";
import { openOnly, type Order, type StoredOrder } from "@/lib/dex/orders";

/**
 * Reading the order book, for callers that are already on the server.
 *
 * Separate from the `fetchOrders` in dex/orders.ts, which goes through
 * `/api/orders` because it runs in a browser. Both exist and neither is
 * redundant: a relative fetch has no host on the server, and a Supabase client in
 * the bundle would ship the query to every visitor. The row→StoredOrder mapping
 * is the part that must not be written twice — it is the seam where a column
 * rename becomes a silently-undefined field — so it lives here and the route's
 * GET calls it rather than repeating the select.
 *
 * Only the query lives here. Everything that reasons about the rows once they
 * have arrived — matching a digest, labelling a pair, describing an order — is in
 * dex/orders.ts, which is pure: build.ts needs those helpers and is imported by
 * the browser planner, so a supabase import reachable from it would put this
 * client in every visitor's bundle to serve a path that never runs there.
 *
 * The anon client, deliberately, exactly as the route's GET uses it: the table's
 * RLS policy allows SELECT and revokes every write from anon, so a read path
 * built on it cannot be turned into a write path by a later edit. The keeper is
 * the only writer and it holds the service role.
 */

/** One page of a maker's orders. Enough for a list nobody scrolls. */
const PAGE = 100;

/**
 * The most rows one keeper sweep will look at on one chain.
 *
 * Not the same number as the sweep's own cap: this bounds the query, that one
 * bounds the RPC calls. The gap between them is deliberate — `sweepable` can only
 * report what it dropped if it is handed more than it takes, and a cap that
 * reports nothing reads as "we looked at everything".
 *
 * Exported so the keeper can tell a full page from a complete one.
 */
export const SWEEP_CEILING = 500;

/** Every column StoredOrder needs, and none it doesn't. */
const COLUMNS =
  "order_hash, chain_id, orders, signature, sig_unverified, order_json, status, fills, last_fill_at, created_at";

/**
 * One row as the app understands it.
 *
 * The single place the column names are spelled, which is the point of the file:
 * a rename becomes one broken reference here instead of a field that is silently
 * `undefined` in three callers.
 */
export function rowToStoredOrder(row: Record<string, unknown>): StoredOrder {
  return {
    /* The object the digest was signed over, verbatim — never reassembled from
       the flat columns beside it. Those exist for indexing and for the check
       constraints; re-deriving the struct from them would let a column that
       drifted from `order_json` produce a different hash and a signature that
       verifies nowhere. */
    order: row.order_json as Order,
    signature: row.signature as string,
    hash: row.order_hash as string,
    chainId: row.chain_id as number,
    orders: row.orders as string,
    fills: (row.fills as number) ?? 0,
    lastFillAt: (row.last_fill_at as number | null) ?? null,
    status: row.status as StoredOrder["status"],
    createdAt: row.created_at as string,
  };
}

/**
 * One maker's orders on one chain, newest first, whatever their status.
 *
 * Throws on a failed query rather than returning an empty array, because the two
 * are different facts and only one of them is safe to act on: "you have no
 * orders" invites placing another, while "we could not read your orders" must not
 * be shown as that. Callers that need a soft failure — `PlanDeps.openOrders` is
 * one — catch it themselves and say so in their own words.
 */
export async function readMakerOrders(
  maker: string,
  chainId: number,
): Promise<StoredOrder[]> {
  const { data, error } = await supabase
    .from("kaleido_limit_orders")
    .select(COLUMNS)
    /* Lowercased to match how POST stores it. `maker` is an address, and an
       address compared case-sensitively is an address that matches nothing for
       whichever caller happens to hold the checksummed form. */
    .eq("maker", maker.toLowerCase())
    .eq("chain_id", chainId)
    .order("created_at", { ascending: false })
    .limit(PAGE);

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => rowToStoredOrder(row as Record<string, unknown>));
}

/**
 * A maker's orders that can still do something, on one chain.
 *
 * The filter itself is `openOnly` in dex/orders.ts, shared with the limit page
 * and the browser planner — this is only the server's way in to it. What "still
 * do something" means, and why a stale status column is trusted here while
 * `expiry` is not, is argued there.
 */
export async function readOpenOrders(
  maker: string,
  chainId: number,
  now = Math.floor(Date.now() / 1000),
): Promise<StoredOrder[]> {
  return openOnly(await readMakerOrders(maker, chainId), now);
}

/**
 * Every order on one chain a keeper might still be able to fill, oldest first.
 *
 * Everyone's, not one maker's — the only query in this file that is not scoped to
 * a wallet, because a filler is not a participant in the order it fills. It is the
 * public-read property the table's RLS policy exists for, and it goes through the
 * anon client like every other read here: the keeper needs the service role to
 * *write* its reconciliation, not to see the book.
 *
 * `status` and `expiry` narrow the set to the sweep index's exact predicate. The
 * status column is this keeper's own cache and can say `open` about an order the
 * chain has already finished, so `sweepable` re-checks expiry after the fact — the
 * filter here is to keep the query cheap, not to be trusted.
 *
 * Ordered oldest-first so a long-standing order is not starved by newer ones when
 * the caller's own cap bites, and capped at {SWEEP_CEILING}: the caller is told how
 * many it did not reach rather than being handed the whole table.
 */
export async function readFillableOrders(
  chainId: number,
  now = Math.floor(Date.now() / 1000),
): Promise<StoredOrder[]> {
  const { data, error } = await supabase
    .from("kaleido_limit_orders")
    .select(COLUMNS)
    .eq("chain_id", chainId)
    .eq("status", "open")
    .gt("expiry", now)
    .order("created_at", { ascending: true })
    .limit(SWEEP_CEILING);

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => rowToStoredOrder(row as Record<string, unknown>));
}
