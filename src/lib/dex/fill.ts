import {
  swapInputFor,
  type Order,
  type OrderStatus,
  type StoredOrder,
} from "@/lib/dex/orders";

/**
 * What a filler decides, separated from how it finds out.
 *
 * The keeper is a script that talks to five chains and a database, and none of
 * that is testable. What IS testable is the decision it makes per order: fill
 * along this route, wait, or write the row off. So the decision lives here as
 * pure functions over values the script has already fetched, and the script is
 * left holding nothing but I/O.
 *
 * The reason that matters more than tidiness: a filler that decides wrongly costs
 * the maker nothing — the floor is enforced by the router against `minOut` no
 * matter who calls `fill` — but it costs gas on a reverted transaction every
 * cycle, forever, on an order it will never be able to fill. The failure mode is
 * a quiet drain rather than a loss, which is exactly the kind that survives
 * unnoticed without tests.
 *
 * Nothing here knows a column name or an RPC. See scripts/fill-orders.mts for the
 * loop that feeds it.
 */

/** `checkFill`'s answer: whether the order's own terms permit a fill right now. */
export interface TermsCheck {
  ok: boolean;
  /** The contract's own string. Empty when `ok`. */
  reason: string;
}

/** One route's quote. `out: null` is "no pool" or "the quote reverted". */
export interface TierQuote {
  fee: number;
  out: bigint | null;
}

/** The state `stateOf(order)` returns, as numbers. */
export interface OnChainState {
  /**
   * Cancelled by the maker, by either route — and the caller has to compose it,
   * because the struct only shows one of them.
   *
   * `cancel(order)` sets `_state.cancelled`. `cancelAll()` bumps `epochOf(maker)`
   * instead and leaves the struct untouched, so an order killed that way reads as
   * live here: every field says open and only the epoch comparison disagrees. The
   * keeper already has that comparison — `checkFill` answers "cancelled by the
   * maker" for it — and ORs the two before calling {reconcile}. Taking the struct
   * alone would leave a `cancelAll`'d order in the list forever, re-quoted every
   * cycle and shown to the maker as pending.
   */
  cancelled: boolean;
  fills: number;
  /** Unix seconds. Meaningless while `fills === 0`, and the contract leaves it 0. */
  lastFillAt: number;
}

export type FillDecision =
  /** Send `fill(order, signature, pathFor(order, fee))`. */
  | { action: "fill"; fee: number; quotedOut: bigint; because: string }
  /** Leave the row alone and look again next cycle. */
  | { action: "wait"; because: string }
  /** The order is finished. Write `status` and stop quoting it. */
  | { action: "reconcile"; status: OrderStatus; because: string };

/**
 * `checkFill`'s refusals that are permanent, and the word the row gets for each.
 *
 * Transcribed from KaleidoOrders.sol:270-285 — the strings are the contract's,
 * matched exactly, because a typo here does not fail loudly: an unmatched reason
 * falls through to `wait`, and the keeper goes on quoting a dead order every cycle
 * instead of writing it off. The suite asserts every string this contract can
 * return is either listed here or deliberately absent.
 *
 * Absent on purpose, and each for its own reason:
 *
 *   "not started" / "waiting for the next interval" — the order will be fillable
 *     later. Waiting is the correct answer, and the only one: the row is already
 *     `open` and there is nothing to write.
 *   "malformed order" / "path does not match the pair" — our bug, not the maker's.
 *     A shape the contract rejects cannot reach the store (`/api/orders` mirrors
 *     `_shapeValid`) and the path is built from the order's own two tokens, so
 *     either of these means this code is wrong. Left `open` and logged loudly
 *     rather than written off, because writing it off would hide the bug behind a
 *     row that looks like a maker's decision.
 *   "signature does not match the maker" — the one that looks terminal and isn't.
 *     For an EOA it is dead; for a smart account it is an ERC-1271 call, and a
 *     contract wallet that says no today (a rotated key, a paused module) can say
 *     yes tomorrow. Since in-app email and social wallets ARE smart accounts,
 *     writing these off would quietly cancel orders that are still valid.
 *
 * Exported for the test that reads the contract and checks the two lists still
 * cover it between them.
 */
export const TERMINAL_REASONS: Readonly<Record<string, OrderStatus>> = {
  cancelled: "cancelled",
  "cancelled by the maker": "cancelled",
  expired: "expired",
  "fully filled": "filled",
};

/**
 * The best route among the quotes, or null when nothing quoted.
 *
 * Ties go to the earlier entry, so a caller that passes {FEE_TIERS} in order
 * prefers the lower fee tier when two pools pay the same — the swap is the
 * maker's, and the surplus above the floor is theirs.
 */
export function bestQuote(quotes: TierQuote[]): TierQuote | null {
  let best: TierQuote | null = null;
  for (const q of quotes) {
    if (q.out === null || q.out <= BigInt(0)) continue;
    if (best === null || q.out > (best.out as bigint)) best = q;
  }
  return best;
}

/**
 * Whether to fill one order right now, and along which fee tier.
 *
 * Two independent conditions, and both have to hold: the order's own terms must
 * permit a fill this second (`checkFill`), and some route must pay at least the
 * floor. They are checked in that order because the terms are one RPC call and the
 * quotes are one per tier — but the split is not only about cost. `checkFill`
 * deliberately says nothing about the price (V3 quotes by reverting, so no `view`
 * can reach one), which means the price condition has to be decided by whoever
 * holds the quote. This is that place.
 *
 * @throws if `quotedFor` is not `swapInputFor(amountIn, fillerFeeBps)`. Quoting the
 * full `amountIn` overstates the output by the filler's fee, and near the floor
 * that is the entire difference between an order that looks fillable and a fill
 * that reverts — so the rule is enforced here rather than written in a comment the
 * caller may not read. A caller that gets this wrong has a bug, not bad input.
 */
export function decideFill(args: {
  order: Order;
  terms: TermsCheck;
  /** Quotes taken for `quotedFor`, one per fee tier tried. */
  quotes: TierQuote[];
  /** The input the quotes were taken for. Checked against the fee, not trusted. */
  quotedFor: bigint;
  /** `fillerFeeBps` read from the contract, never assumed — it is storage. */
  fillerFeeBps: number;
}): FillDecision {
  const { order, terms, quotes, quotedFor, fillerFeeBps } = args;

  const expected = swapInputFor(BigInt(order.amountIn), fillerFeeBps);
  if (quotedFor !== expected) {
    throw new Error(
      `Quotes were taken for ${quotedFor} but a fill swaps ${expected} ` +
        `(${order.amountIn} less ${fillerFeeBps}bps). Quote swapInputFor(amountIn, fillerFeeBps).`,
    );
  }

  if (!terms.ok) {
    const status = TERMINAL_REASONS[terms.reason];
    if (status) {
      return {
        action: "reconcile",
        status,
        because: `the contract refuses to fill it: ${terms.reason}`,
      };
    }
    return { action: "wait", because: terms.reason || "the terms refuse a fill" };
  }

  const best = bestQuote(quotes);
  if (!best || best.out === null) {
    return {
      action: "wait",
      because: "no pool quoted this pair, so there is no route to fill along",
    };
  }

  /* Base units, both sides, and deliberately unformatted: this module is not
     given decimals, and a number scaled by a guess is worse in a log than a long
     one. The script has the token entries if it wants to pretty-print. */
  const floor = BigInt(order.minOut);
  if (best.out < floor) {
    return {
      action: "wait",
      because: `the best route pays ${best.out} against a floor of ${floor}`,
    };
  }

  return {
    action: "fill",
    fee: best.fee,
    quotedOut: best.out,
    because: `the ${best.fee / 10_000}% pool pays ${best.out} for a floor of ${floor}`,
  };
}

/**
 * What the row should say, given what the chain says.
 *
 * Read from `stateOf` after a fill rather than incremented locally, and that is
 * the whole point of this function existing: the contract counts the fills, and a
 * keeper that adds one to its own copy is a keeper whose count drifts the first
 * time a transaction lands after its receipt was lost. `fills` and `lastFillAt`
 * come back from the same struct the contract enforces `interval` against, so the
 * row agrees with what the next fill will actually be allowed to do.
 *
 * Precedence — cancelled, then filled, then expired — because the words describe
 * different kinds of fact and the more specific one wins. A maker who cancelled an
 * order that later expired did something; expiry is only the absence of anything.
 * An order that used its last fill and then ran out its window did its job, and
 * "expired" would read as though it had not.
 *
 * `lastFillAt` is null while `fills` is 0 rather than the 0 the struct carries, for
 * the reason {nextFillAt} refuses to substitute `startAt`: a timestamp of 0 is
 * 1970, and an interval measured from 1970 says every recurring order is ready now.
 */
export function reconcile(
  order: Order,
  state: OnChainState,
  now: number,
): { status: OrderStatus; fills: number; lastFillAt: number | null } {
  const status: OrderStatus = state.cancelled
    ? "cancelled"
    : state.fills >= order.maxFills
      ? "filled"
      : now > order.expiry
        ? "expired"
        : "open";

  return {
    status,
    fills: state.fills,
    lastFillAt: state.fills > 0 ? state.lastFillAt : null,
  };
}

/**
 * The orders a sweep should look at, oldest first.
 *
 * `expiry` is checked here as well as in the query because the row's `status` is
 * this keeper's own cache: a row can be `open` and expired at once, and the whole
 * cost of the pair is one wasted `checkFill` per cycle per dead order. Sorting by
 * `createdAt` is what keeps a long-standing order from being starved by newer ones
 * when the cap below bites — the same reason the table's sweep index is ordered
 * that way.
 *
 * `limit` bounds one cycle's RPC spend rather than the work: what is dropped is
 * dropped for this cycle only, and the next one sees it first because the sort is
 * stable and the filled ones have left the set. The caller logs the number
 * dropped — a silent cap reads as "we looked at everything".
 */
export function sweepable(
  rows: StoredOrder[],
  now: number,
  limit: number,
): { take: StoredOrder[]; dropped: number } {
  const live = rows
    .filter((r) => r.status === "open" && r.order.expiry > now)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { take: live.slice(0, limit), dropped: Math.max(0, live.length - limit) };
}
