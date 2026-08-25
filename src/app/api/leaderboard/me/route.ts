/**
 * One wallet's standing on the board.
 *
 * Separate from /api/leaderboard rather than a parameter on it, for two reasons
 * that are both about the cache. That route memoises on `(season, limit)` and
 * that key deliberately contains no wallet: a per-caller value in a
 * process-local cache shared by every request is how one visitor gets served
 * another visitor's row. And a board is the same for everyone for 60 seconds,
 * while "where am I" is the one figure a user refreshes expecting it to move. So
 * this route is uncached, and the two never share a code path that could grow a
 * cache by accident.
 *
 * WHAT THIS DOES NOT DO, AND WHY
 *
 * docs/points-system.md §8 grants any user "their own exact rank and points"
 * — tier 2, stricter than the public tier. This route does not serve that. It
 * reads the same masked `point_leaderboard` the public board reads, so a wallet
 * outside `public_rank_limit` gets a percentile and no exact rank, exactly as if
 * it had been found in the public table.
 *
 * That is deliberate, because `?wallet=` proves nothing. The moment this route
 * returns more than the view does, it becomes an oracle that de-masks any wallet
 * for anyone who types its address — and at a `rank_only` season, where
 * `point_source_rates` is public and the swap rate is 1.0 points per USD, that
 * oracle answers "what is this wallet's USD volume" for the whole book. That is
 * the map 20260817000000 closed `point_balances` to prevent, rebuilt as an HTTP
 * endpoint.
 *
 * Serving tier 2 properly needs proof of control of the address: a message the
 * client signs, `ethers.verifyMessage` on this side, a bound domain and a short
 * freshness window, and only then a service-role read of the wallet's own row.
 * That is a real surface with its own replay questions, and it buys nothing at
 * the only season that has data — Season 0 is `disclosure = 'totals'` with
 * `public_rank_limit = 100` and a seeded population well inside it, so the
 * masked view already gives every participating wallet its exact rank and total.
 * It has to exist before a season runs at `rank_only` with more than 100 wallets.
 */

import { NextResponse, type NextRequest } from "next/server";

import { supabase } from "@/lib/supabase/supabaseClient";
import type {
  LeaderboardRow,
  LeaderboardStanding,
} from "@/lib/points/leaderboard";

export const dynamic = "force-dynamic";

const ROW_COLUMNS =
  "wallet, rank, percentile, total, time_points, action_points, bonus_points";

interface RowRecord {
  wallet: string;
  rank: number | null;
  percentile: number | null;
  total: number | string | null;
  time_points: number | string | null;
  action_points: number | string | null;
  bonus_points: number | string | null;
}

/** Same reason as the board route: Postgres `numeric` arrives as a string. */
function num(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const rawWallet = searchParams.get("wallet");
  /*
   * Lowercased before the query, not compared case-insensitively in it. Every
   * writer of `point_balances.wallet` lowercases first — the Season 0 seed does
   * it in SQL and gates on `^0x[0-9a-f]{40}$` — so the column holds one casing
   * and an `ilike` here would only be a slower way to find the same row, while
   * silently tolerating a schema that had stopped normalising.
   */
  const wallet = (rawWallet ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
    return NextResponse.json(
      { success: false, error: "wallet must be a 0x-prefixed 20-byte address" },
      { status: 400 },
    );
  }

  const rawSeason = searchParams.get("season");
  /*
   * Required, unlike on the board route. There the default season is a product
   * decision the page inherits; here the caller already knows which season it is
   * displaying, and resolving a second time could answer about a different one
   * than the board beside it — a "your standing" card disagreeing with the table
   * under it is worse than a 400.
   */
  const season = Number(rawSeason);
  if (
    rawSeason === null ||
    rawSeason.trim() === "" ||
    !Number.isInteger(season)
  )
    return NextResponse.json(
      { success: false, error: "season is required and must be an integer" },
      { status: 400 },
    );

  const [row, count] = await Promise.all([
    supabase
      .from("point_leaderboard")
      .select(ROW_COLUMNS)
      .eq("season", season)
      .eq("wallet", wallet)
      .maybeSingle<RowRecord>(),
    supabase
      .from("point_leaderboard")
      .select("wallet", { count: "exact", head: true })
      .eq("season", season),
  ]);

  if (row.error) {
    console.error("[leaderboard/me] row read failed:", row.error.message);
    return NextResponse.json(
      { success: false, error: "Could not read your standing" },
      { status: 500 },
    );
  }

  /*
   * A missing row is reported as a missing row and nothing more.
   *
   * There are two ways to have none: never having earned a point, and being
   * sybil-flagged — `point_leaderboard` filters on `sybil_flag is null`. Saying
   * which would turn this endpoint into a flag detector, and the flag is an
   * investigative signal: publishing it tells a farmer which of their wallets
   * were caught and therefore what the detector keys on. The view's own comment
   * puts telling a flagged wallet it is flagged under tier 2, which needs the
   * signature this route does not have.
   */
  const mapped: LeaderboardRow | null = row.data
    ? {
        wallet: row.data.wallet,
        rank: row.data.rank,
        percentile: row.data.percentile,
        total: num(row.data.total),
        timePoints: num(row.data.time_points),
        actionPoints: num(row.data.action_points),
        bonusPoints: num(row.data.bonus_points),
      }
    : null;

  const standing: LeaderboardStanding = {
    wallet,
    season,
    row: mapped,
    participants: count.error ? null : (count.count ?? null),
  };

  return NextResponse.json(
    { success: true, data: standing },
    /* no-store on a per-wallet response is the point of the file. A shared cache
       between here and a CDN would key on the URL, which contains the address —
       correct by luck rather than by design, and only until someone adds a
       header that varies. */
    { headers: { "Cache-Control": "no-store" } },
  );
}
