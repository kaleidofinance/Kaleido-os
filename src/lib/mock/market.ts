import { borrowCurrencies } from "@/constants/registry";
import { READ_ONLY_CHAIN_ID } from "@/config/provider";
import {
  foldBook,
  valueBook,
  type BookRow,
  type MarketOverview,
} from "@/lib/market/bookValue";

import { MOCK_LISTINGS, MOCK_REQUESTS } from "./lending";
import { MOCK_STABLE_STATS } from "./stable";
import { MOCK_STAKE } from "./stake";
import { MOCK_USD } from "./quotes";

/**
 * Protocol headline figures — the two StatStrips.
 *
 * `/api/market/overview` counts and values the two mirror tables in Supabase.
 * Nothing has indexed them, so every tile on /leaderboard and on all four
 * Borrow/Lend tabs renders an em dash, and `coverageNote` says "No positions
 * indexed yet" underneath — an honest report of an empty index, and no evidence
 * at all about whether the strip works.
 *
 * ALMOST NOTHING BELOW IS A TYPED-IN NUMBER. The counts, the dollar total and the
 * whole coverage record are computed here by running ./lending's own book through
 * `foldBook` and `valueBook` — the same two functions the route calls, with the
 * same `borrowCurrencies` decimals table. That is deliberate to the point of
 * being the reason this file is worth having:
 *
 *   - The strip cannot contradict the table beneath it. "Open offers: 6" is
 *     `MOCK_LISTINGS.filter(OPEN).length`, so a row added to the fixture book
 *     moves the tile, and a reader who counts the rows on /borrow gets 6.
 *   - "Open book: $x" is those rows actually summed at those decimals. Hand-typing
 *     it would be reproducing, by eye, the exact arithmetic the route exists to
 *     get right — a book mixing 6-decimal USDC with 18-decimal ether and kfUSD is
 *     what produced the "$1,000,000,000,001,000,000" this route was written to
 *     fix, and a fixture that guessed the answer could not detect a regression in
 *     it.
 *   - `coverage` is measured, not asserted. If a fixture row ever names a token
 *     outside borrowCurrencies or writes an amount that is not a base-unit
 *     integer, `unknownToken` or `malformedAmount` rises and the note appears by
 *     itself. Today all eight rows fold cleanly and the note stays absent, which
 *     is the truthful state — a fabricated "excludes 2 unpriced" would put a
 *     footnote on screen describing rows that do not exist.
 *
 * `loansOutstanding` is SERVICED requests, not `MOCK_LOANS.length`: those are the
 * viewer's own funded loans, a subset, and the route counts the whole book
 * (api/market/overview/route.ts:125-131).
 *
 * kfUSD supply and staked KLD come from ./stable and ./stake, so the number in
 * this strip is the number on /stable and /stake. KLD is counted IN KLD and never
 * in dollars — it has no market price before TGE, which is the same reason
 * `prices.ts` lists it as unpriced rather than giving it a feed.
 *
 * WHAT IS DELIBERATELY NOT DEGRADED: `degraded` is empty. Naming a leg there
 * makes its tile read "Unavailable" on every page for as long as the flag is on,
 * and there is nothing to learn from a permanently broken figure that the
 * unmocked app was not already showing. The failure paths that matter — a null
 * total, a partial total with a coverage footnote — are reachable by turning the
 * flag off, which is where they belong.
 *
 * WHAT THE DERIVATION SHOULD PRODUCE, as of the book ./lending describes today —
 * checked by folding those rows through these same two functions:
 *
 *   openOffers 6 · openRequests 2 · loansOutstanding 6
 *   USDC 310,000 (2 rows) · ETH 51.75 (3) · kfUSD 205,000 (2) · USDT 96,500 (1)
 *   lendingTvlUsd 787,450 · coverage 8 rows, 8 valued, nothing excluded
 *
 * If a figure on screen disagrees with that, the fixture book changed and this
 * list is what tells you whether the change was intended.
 */

/** The rows the route values: OPEN listings, then OPEN requests, in that order. */
const OPEN_LISTINGS = MOCK_LISTINGS.filter((l) => l.status === "OPEN");
const OPEN_REQUESTS = MOCK_REQUESTS.filter((r) => r.status === "OPEN");

const BOOK: BookRow[] = [...OPEN_LISTINGS, ...OPEN_REQUESTS].map((row) => ({
  tokenAddress: row.tokenAddress,
  amount: row.amount,
}));

/**
 * Priced from ./quotes' table, so the swap card, the pool table and this tile all
 * value an ether identically. A symbol with no entry returns null, which is
 * exactly what the real `priceOf` does for an asset Pyth has no feed for — so
 * `valueBook` counts it as unpriced here for the same reason it would there.
 */
const { usd, coverage } = valueBook(
  foldBook(BOOK, borrowCurrencies(READ_ONLY_CHAIN_ID)),
  (s) => (s in MOCK_USD ? MOCK_USD[s] : null),
);

/**
 * kfUSD supply as a number.
 *
 * ./stable publishes it as a display string ("2,481,904.55") because that is what
 * `useStablecoin` returns; this field is a number. Parsed back rather than
 * duplicated, so the two cannot drift — a fixture reading its own sibling is a
 * better coupling than the same figure typed twice.
 */
const KFUSD_SUPPLY = Number(MOCK_STABLE_STATS.kfUSDSupply.replace(/,/g, ""));

/** Fixed, never `new Date()`: the lending shell's strip renders server-side. */
const AS_OF = "2026-08-19T08:00:00.000Z";

export const MOCK_MARKET: MarketOverview = {
  lendingTvlUsd: usd,
  openOffers: OPEN_LISTINGS.length,
  openRequests: OPEN_REQUESTS.length,
  /* SERVICED requests are loans that exist and are being repaid. CLOSED ones are
     finished, and OPEN ones have no lender yet. */
  loansOutstanding: MOCK_REQUESTS.filter((r) => r.status === "SERVICED").length,
  kfUsdSupply: KFUSD_SUPPLY,
  kldStaked: MOCK_STAKE.totalStaked,
  coverage,
  asOf: AS_OF,
  degraded: [],
};
