import type {
  LeaderboardPayload,
  LeaderboardRow,
  LeaderboardSeason,
  LeaderboardSeasonRef,
  LeaderboardStanding,
} from "@/lib/points/leaderboard";

/**
 * Demo points board — two seasons, two disclosure tiers.
 *
 * /leaderboard reads `point_leaderboard` through `/api/leaderboard`. Nothing has
 * ever written to `point_balances`, so the board renders "Nobody is ranked in this
 * season yet" and the standing card renders "Unranked" — which proves the empty
 * state and nothing else. Every column, the tier chips, the season picker and both
 * grid templates go unexercised.
 *
 * TWO SEASONS, BECAUSE ONE TIER CANNOT SHOW THE PAGE. The disclosure tier decides
 * how many columns the table has, which chips appear in the header, and which of
 * `tierNote`'s three paragraphs is printed. A single season would leave two thirds
 * of that unreachable, and the `<select>` only renders at all when `seasons.length
 * > 1` (page.tsx:174), so a one-season fixture also hides the picker.
 *
 *   Season 2 — running, the default, `totals`. Ranks and point totals, the three
 *     components withheld. Two columns. This is the everyday view.
 *   Season 1 — frozen, `full`. Five columns, exact ranks past the public limit,
 *     and the time/action/bonus split published for audit.
 *
 * THE MASKING IS REAL, NOT DECORATION. At `totals` the three component fields are
 * genuinely null on every row, because that is what the view returns and what the
 * season's tier means — the split stays private until the freeze. `qty(null)`
 * renders an em dash, and a fixture that filled those in with plausible numbers
 * would be showing a disclosure the product does not make.
 *
 * NO ROW IS ATTRIBUTED TO THE CONNECTED WALLET, so the "You" tag and the
 * `.rowYou` highlight stay unexercised. That is a real gap and it is the lesser
 * evil: `useLeaderboard` takes only a season, deliberately — the board is
 * identical for every visitor and cached for a minute, and its own header says so
 * — so it has no address to substitute in. Reading one there would contradict the
 * design of the hook to decorate a fixture. The connected wallet instead gets its
 * own row through `mockStanding`, which does receive an address, and that row sits
 * outside the published slice so the two surfaces cannot claim the same rank for
 * two different wallets.
 *
 * THE STANDING'S SEASON 2 ROW IS RANK-MASKED ON PURPOSE — `rank: null` with a
 * percentile. Past `public_rank_limit` a wallet is not in the published slice at
 * all and its band is the only answer it gets, which is the case the standing card
 * exists for and the one branch of `rankText` the table can never reach. The route
 * caps a non-`full` board at the rank limit (api/leaderboard/route.ts:144-148), so
 * a masked row in the table is not a state the real thing produces.
 *
 * FOURTEEN ROWS, not the fifty the route's default limit would return. Enough to
 * fill the table, and `truncated` is true either way — which is the thing that
 * tells the page its slice is a slice, and prints the export note. Thirty-six more
 * fabricated addresses would add nothing.
 *
 * ARITHMETIC A READER CAN CHECK: at the full tier every row's three components sum
 * to its total, and totals descend with rank in both seasons. The standing's total
 * sits below the fourteenth row's in both, which is what makes its rank consistent
 * with not appearing in the slice.
 *
 * DATES ARE FIXED. Nothing here is derived from the clock — see the module header.
 */

/** Fabricated wallets, lowercase: 36 hex from a repeated word plus an index. */
const board = (n: number) =>
  `0x${"1eaf".repeat(9)}${String(n).padStart(4, "0")}`;

const AS_OF = "2026-08-19T08:00:00.000Z";

/* ------------------------------------------------------------- season 2 -- */

const S2_PARTICIPANTS = 4_832;

/** Descending, rank 1 first. */
const S2_TOTALS = [
  184_205, 171_940, 168_312, 152_887, 149_003, 141_226, 133_804, 128_115,
  121_470, 117_982, 110_355, 104_218, 98_640, 92_117,
];

/**
 * The band the view publishes alongside a rank.
 *
 * `ceil`, not `round`, and the difference is not cosmetic. The view computes
 * `ceil(100 * cume_dist())` — migrations/20260817000000_leaderboard_disclosure.sql:138,
 * repeated at 20260818000000:232 with the note "ceil, not round" — because the top
 * wallet of a thousand is "top 1%" and never "top 0%". Rounding moves whole bands:
 * rank 96 of 1,893 is 5.07%, which rounds to 5 and ceils to 6.
 *
 * `cume_dist()` over `order by total desc` is the count of rows at or before this
 * one divided by the total, so with no ties in either season — and there are none,
 * every total below is distinct — rank r over N participants is exactly r/N, which
 * is what this computes. Ceil needs no floor at 1: any positive rank gives a
 * positive fraction, so the result cannot come out 0 on its own.
 *
 * Only read when `rank` is null, which for these rows it never is — carried anyway
 * because the view carries it, and a fixture that dropped the column would let a
 * consumer that reads it look correct against data that has it.
 */
const band = (rank: number, participants: number) =>
  Math.ceil((rank / participants) * 100);

const S2_ROWS: LeaderboardRow[] = S2_TOTALS.map((total, i) => ({
  wallet: board(i + 1),
  rank: i + 1,
  percentile: band(i + 1, S2_PARTICIPANTS),
  total,
  /* Withheld by the tier, not missing. */
  timePoints: null,
  actionPoints: null,
  bonusPoints: null,
}));

const SEASON_2: LeaderboardSeason = {
  id: 2,
  label: "Season 2",
  disclosure: "totals",
  publicRankLimit: 50,
  startsAt: "2026-07-01T00:00:00.000Z",
  endsAt: null,
  frozenAt: null,
  convertsToTokens: true,
  isDefault: true,
};

/* ------------------------------------------------------------- season 1 -- */

const S1_PARTICIPANTS = 1_893;

/**
 * The published split, rank 1 first: [time, action, bonus]. The total is their
 * sum, computed rather than written, so the five columns on screen add up.
 *
 * A zero bonus is a zero, never a null — at the audit tier the figure is published
 * and the published figure is that the wallet earned no bonus. Rendering it as an
 * em dash would say the opposite.
 */
const S1_SPLIT: [number, number, number][] = [
  [96_400, 82_150, 12_000],
  [91_120, 70_640, 8_000],
  [88_450, 61_300, 12_000],
  [74_900, 66_820, 4_000],
  [71_205, 58_410, 8_000],
  [68_040, 52_970, 0],
  [61_880, 47_115, 4_000],
  [58_320, 44_690, 0],
  [52_770, 40_225, 4_000],
  [49_610, 36_880, 0],
  [44_150, 33_402, 4_000],
  [40_905, 29_760, 0],
  [36_440, 26_115, 0],
  [32_180, 23_490, 4_000],
];

/**
 * The same fourteen wallets, in a different order.
 *
 * Season 1's board is not season 2's with new numbers: the wallet that finished
 * third last season sits first this one. A fixture that ranked them identically in
 * both would make the picker look like it had changed nothing but the digits.
 */
const S1_ORDER = [3, 1, 7, 2, 9, 4, 12, 5, 14, 6, 11, 8, 13, 10];

const S1_ROWS: LeaderboardRow[] = S1_SPLIT.map(
  ([timePoints, actionPoints, bonusPoints], i) => ({
    wallet: board(S1_ORDER[i]),
    rank: i + 1,
    percentile: band(i + 1, S1_PARTICIPANTS),
    total: timePoints + actionPoints + bonusPoints,
    timePoints,
    actionPoints,
    bonusPoints,
  }),
);

const SEASON_1: LeaderboardSeason = {
  id: 1,
  label: "Season 1",
  disclosure: "full",
  publicRankLimit: 50,
  startsAt: "2026-02-01T00:00:00.000Z",
  endsAt: "2026-06-30T23:59:59.000Z",
  frozenAt: "2026-07-07T12:00:00.000Z",
  /* The season the points were a record of participation and nothing more. This
     is a material disclosure and the page prints it — see page.tsx:138. */
  convertsToTokens: false,
  isDefault: false,
};

/* ----------------------------------------------------------------- board -- */

/** Ordered by id ascending, as the route's third query returns them. */
const SEASON_REFS: LeaderboardSeasonRef[] = [
  { id: SEASON_1.id, label: SEASON_1.label, frozenAt: SEASON_1.frozenAt },
  { id: SEASON_2.id, label: SEASON_2.label, frozenAt: SEASON_2.frozenAt },
];

function payload(
  season: LeaderboardSeason,
  rows: LeaderboardRow[],
  participants: number,
): LeaderboardPayload {
  return {
    season,
    seasons: SEASON_REFS,
    rows,
    participants,
    truncated: participants > rows.length,
    asOf: AS_OF,
    degraded: [],
  };
}

/**
 * One season's board.
 *
 * `null` means the season flagged `is_default`, matching the route: the page
 * deliberately does not seed a season id of its own, so this has to resolve one.
 * An id that is neither of the two falls back to the default rather than throwing
 * — the real route answers "Season N does not exist", but the only ids reachable
 * from the page are the two in the picker, and a fixture that threw inside a
 * hook's loader would render the error state for a request the UI cannot make.
 */
export function mockLeaderboard(season: number | null): LeaderboardPayload {
  if (season === SEASON_1.id) {
    return payload(SEASON_1, S1_ROWS, S1_PARTICIPANTS);
  }
  return payload(SEASON_2, S2_ROWS, S2_PARTICIPANTS);
}

/* -------------------------------------------------------------- standing -- */

/**
 * The connected wallet's row, per season.
 *
 * Season 2 is rank-masked with a band — see the module header for why that is the
 * interesting case rather than a shortcut. Season 1 is frozen and published in
 * full, so it carries an exact rank and the split.
 *
 * BOTH BANDS ARE THE ONES `band` WOULD RETURN, written out because these two rows
 * have no rank to derive them from at the tier that matters. Season 1: rank 96 of
 * 1,893 is 5.07%, and `ceil` makes that 6. Season 2 carries no rank at all, so 8
 * has to be read backwards — a band of 8 puts the wallet somewhere in ranks 339 to
 * 386 of 4,832, which is past the 50-rank public limit and therefore exactly the
 * reason the rank beside it is null.
 *
 * Both totals sit below the fourteenth published row's, which is what makes "not
 * in the slice" consistent rather than merely unfalsifiable. Season 1's three
 * components sum to its total, like every row in that season's table.
 */
const STANDING_ROWS: Record<number, Omit<LeaderboardRow, "wallet">> = {
  2: {
    rank: null,
    percentile: 8,
    total: 41_820,
    timePoints: null,
    actionPoints: null,
    bonusPoints: null,
  },
  1: {
    rank: 96,
    percentile: 6,
    total: 38_240,
    timePoints: 21_360,
    actionPoints: 14_880,
    bonusPoints: 2_000,
  },
};

const PARTICIPANTS: Record<number, number> = {
  2: S2_PARTICIPANTS,
  1: S1_PARTICIPANTS,
};

/**
 * A wallet's standing in one season.
 *
 * The row is attributed to the address that asked, which is the same
 * re-attribution `mockListings` does and for the same reason: a standing card
 * showing a stranger's rank under the heading "Your standing" is worse than an
 * empty one.
 *
 * An unknown season returns a null row, which the page renders as "Unranked" — the
 * honest answer to a season this wallet has no record in, and the branch that
 * would otherwise go unexercised.
 */
export function mockStanding(
  wallet: string,
  season: number,
): LeaderboardStanding {
  const row = STANDING_ROWS[season];
  return {
    wallet,
    season,
    row: row ? { wallet, ...row } : null,
    participants: PARTICIPANTS[season] ?? null,
  };
}
