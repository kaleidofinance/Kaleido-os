/**
 * Wire types for /api/leaderboard.
 *
 * Types only, no runtime — the page imports these into a client component, and a
 * module that also carried a helper would drag whatever that helper imports into
 * the browser bundle. Same split as `@/lib/market/bookValue` serves for the
 * overview strip.
 *
 * WHY EVERY PER-WALLET FIGURE IS NULLABLE
 *
 * Not a convenience. `point_leaderboard` masks columns according to the season's
 * `disclosure` tier (20260817000000_leaderboard_disclosure.sql), so `total` is
 * genuinely absent at `rank_only`, and `rank` is absent for every row past
 * `public_rank_limit`. The nulls are the privacy property arriving in the type
 * system: a component that wants to render a total has to decide what to do when
 * it is not entitled to one, at compile time.
 *
 * WHY THERE IS NO `username`
 *
 * `useUpdateTable.ts` upserts into `kaleido` with `onConflict: "username"` from
 * the browser, so usernames are client-set, unverified and squattable. Publishing
 * one beside a rank turns a leaderboard into an impersonation surface — the wallet
 * at #1 could be displaying any name it liked. Addresses are what the chain
 * attests to, so addresses are what this publishes. Named accounts need
 * server-side claims first; that is a separate piece of work, not a field.
 */

/** What the public board may show about one wallet, after the view has masked it. */
export interface LeaderboardRow {
  wallet: string;
  /** Exact rank. Null past the season's `public_rank_limit` — use `percentile`. */
  rank: number | null;
  /** 1–100, always present. Ordinal, so it discloses no size at any tier. */
  percentile: number | null;
  /** Null unless the season's disclosure is `totals` or `full`. */
  total: number | null;
  /** The three components. Null unless disclosure is `full` (post-freeze audit). */
  timePoints: number | null;
  actionPoints: number | null;
  /** Discretionary credit — Season 0 participation. Not a measurement. */
  bonusPoints: number | null;
}

/**
 * The season the board is for. Sent alongside the rows because every masking
 * decision above follows from it, and a client that cannot see the tier cannot
 * explain to the user why a column is blank.
 */
export interface LeaderboardSeason {
  id: number;
  label: string;
  disclosure: "rank_only" | "totals" | "full";
  publicRankLimit: number;
  startsAt: string;
  endsAt: string | null;
  frozenAt: string | null;
  convertsToTokens: boolean;
  isDefault: boolean;
}

/**
 * Enough of a season to put in a selector. `point_seasons` is anon-readable
 * ("seasons readable" in 20260801000100), so this list is not a disclosure — the
 * client could query it directly. It travels with the payload so the page does
 * not need a second round trip to know what it may switch to.
 */
export interface LeaderboardSeasonRef {
  id: number;
  label: string;
  /** Set once the season's totals are final. Renders as a Frozen chip. */
  frozenAt: string | null;
}

export interface LeaderboardPayload {
  season: LeaderboardSeason;
  /** Every season, oldest first, for the selector. Includes the current one. */
  seasons: LeaderboardSeasonRef[];
  rows: LeaderboardRow[];
  /**
   * Unflagged wallets in the season — the denominator `percentile` is computed
   * against. Null when the count could not be read; an aggregate, so it discloses
   * nothing about any wallet.
   */
  participants: number | null;
  /** True when `participants` exceeds the rows returned. See the route's HARD_MAX. */
  truncated: boolean;
  asOf: string;
  /** Names each leg that failed, so a null is never mistaken for "still loading". */
  degraded: string[];
}

/**
 * One wallet's own standing, from /api/leaderboard/me.
 *
 * The same masked figures the public board would show for that row — this is a
 * lookup into `point_leaderboard`, not a privileged read. §8 tier 2 ("their own
 * exact rank and points") needs proof of wallet control to serve safely; the
 * route's header says why that is not built and what it would take.
 */
export interface LeaderboardStanding {
  wallet: string;
  season: number;
  /**
   * Null when the wallet has no row in this season's board. Deliberately
   * ambiguous between "never participated" and "sybil-flagged" — see the route.
   */
  row: LeaderboardRow | null;
  participants: number | null;
}
