/**
 * Shared query rules for the two order-book routes (/api/listings,
 * /api/requests).
 *
 * They are near-identical copies of each other, and that is how the bug this file
 * fixes ended up in both: `searchId` was applied as
 * `id.eq.<v>,id.ilike.%<v>%` against `"listingId" bigint` / `"requestId" bigint`
 * (see supabase/migrations/20260731000000_kaleido_core_tables.sql). Postgres has
 * no `~~*` for bigint, so a numeric id search failed with
 * `operator does not exist: bigint ~~* unknown`, and a non-numeric one failed
 * even earlier on `invalid input syntax for type bigint` — both in the *count*
 * query, so **every possible input returned 500**. The only live caller is the
 * agent planner's fetchMarketRow (the UI's searchByIdAtom has no writer), which
 * means "fund listing #12" through the agent has never once resolved.
 *
 * Whatever is done to one route's id handling must be done to the other, so it
 * lives here rather than twice.
 */

/** Largest value Postgres `bigint` accepts. Beyond it the query errors, not 0 rows. */
const PG_BIGINT_MAX = BigInt("9223372036854775807");

export type BookIdSearch =
  | { kind: "none" }
  /** A usable id. Filter with `.eq(field, value)`. */
  | { kind: "exact"; value: string }
  /** Syntactically incapable of matching a bigint id — answer empty, don't query. */
  | { kind: "impossible"; reason: string };

/**
 * Interprets the `searchId` parameter.
 *
 * Exact match only. The previous partial (`ilike %id%`) behaviour could not work
 * on a bigint column, and it should not be restored by casting the column to
 * text: ids are a primary key, "3" matching 13 and 31 is not a useful search, and
 * fetchMarketRow already had to re-filter for an exact id client-side precisely
 * because a near-miss here means building a transaction against a stranger's
 * order. Exactness is the feature.
 */
export function parseBookIdSearch(raw: string | null): BookIdSearch {
  if (!raw) return { kind: "none" };

  const trimmed = raw.trim();
  if (!trimmed) return { kind: "none" };

  if (!/^\d+$/.test(trimmed)) {
    return {
      kind: "impossible",
      reason: `"${trimmed}" is not an order id`,
    };
  }

  // Strip leading zeros so "007" and "7" agree; BigInt handles them, but the
  // value is interpolated into a PostgREST filter as a string.
  const value = BigInt(trimmed).toString();

  if (BigInt(value) > PG_BIGINT_MAX) {
    return {
      kind: "impossible",
      reason: `no order id is that large`,
    };
  }

  return { kind: "exact", value };
}

/**
 * Columns a book route will sort and cursor-paginate on.
 *
 * Deliberately narrow: `sortBy` arrives from the query string and is fed to both
 * `.order()` and the cursor's `.lt()`/`.gt()`, so any text column named here
 * would reintroduce the lexicographic comparison the amount floor above was
 * removed for — `.order("amount")` sorts "9" after "100", and a text cursor
 * paginates in that same wrong order, skipping rows. Everything listed is
 * `bigint`, `numeric` or `timestamptz` per
 * supabase/migrations/20260731000000_kaleido_core_tables.sql; `amount`,
 * `minAmount`, `maxAmount` and `totalRepayment` are text and are excluded for
 * that reason, not by omission.
 *
 * No caller sets `sortBy` today — both routes fall through to their id column —
 * so this closes a door rather than changing behaviour.
 */
const SORTABLE: Record<"listings" | "requests", readonly string[]> = {
  listings: ["listingId", "returnDate", "interest", "created_at"],
  requests: ["requestId", "listingId", "returnDate", "interest", "created_at"],
};

/**
 * Resolves `sortBy`, falling back to the table's id when the requested column is
 * absent or unsafe to compare. Returns the fallback rather than erroring: a
 * mis-sorted book is a worse answer than an unhonoured sort preference, and the
 * caller is a page trying to render, not an operator who can read a 400.
 */
export function resolveBookSort(
  kind: "listings" | "requests",
  raw: string | null,
): { column: string; ignored: string | null } {
  const fallback = kind === "listings" ? "listingId" : "requestId";
  if (!raw || raw === fallback) return { column: fallback, ignored: null };
  if (SORTABLE[kind].includes(raw)) return { column: raw, ignored: null };
  return { column: fallback, ignored: raw };
}

/*
 * WHY NEITHER ROUTE FILTERS ON `amount` ANY MORE.
 *
 * Both used to apply `.gte("amount", 10000000000000000000)` to drop sub-$10
 * orders. `amount` is a **text** column — deliberately, so PostgREST serialises
 * base units as a JSON string instead of a float64-truncated number — so that
 * comparison ran lexicographically. A 100 USDC listing ("100000000", 6 decimals)
 * is a prefix of the threshold and therefore sorts *below* it and was dropped,
 * while any 18-decimal amount starting with a digit above 1 passed — including
 * literal dust like "5" wei. It removed real orders and admitted the ones it
 * existed to hide, which is why the book could look empty for reasons that had
 * nothing to do with the UI.
 *
 * Fixing only the comparison would have been worse: numerically, a flat
 * 1e19-base-unit floor is 10 million USDC at 6 decimals, so the USDC book would
 * have emptied completely. A base-unit threshold cannot express a USD one.
 *
 * It also never needed to. `ProtocolFacet.sol` enforces the minimum at creation
 * for both order types — createLendingRequest:176 and createLoanListing:695 both
 * revert `Protocol__LoanAmountTooLow` when
 * `getUsdValue(currency, amount, decimals) < Constants.MIN_LOAN_AMOUNT` (10 USD)
 * — decimals-aware and price-aware, via the Pyth feed. These tables are an
 * indexed mirror of orders that already passed that check, so a second floor here
 * can only subtract from a set the chain already validated.
 *
 * ("10 USD" is now literal. The constant read `10 * 1e16` when this was written,
 * which happened to equal 10 USD only because getUsdValue inverted the Pyth
 * exponent conversion; both were corrected to an 18-decimal scale, so the
 * threshold is unchanged in real terms but no longer depends on every feed
 * having an exponent of -8.)
 *
 * If a *display* dust filter is ever wanted (say, hiding orders now worth under
 * $10 because the token moved), it needs live prices and belongs in the UI beside
 * the USD conversion it depends on — not as a string comparison in SQL.
 */
