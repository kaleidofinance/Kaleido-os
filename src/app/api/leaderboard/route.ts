/**
 * Public points leaderboard.
 *
 * Rewritten wholesale. What was here before was a second, divergent points
 * implementation that happened to share a URL with this one:
 *
 *  - It summed `kaleido_protocol_activity.points_earned`, a column that was
 *    browser-written with the anon key and is therefore attacker-set. Anyone
 *    could have ranked first by POSTing a number.
 *  - It invented its own formula — `min(listings, 5) * 100 + min(requests, 5) *
 *    50` — with no relationship to `point_source_rates`, so the board disagreed
 *    with the points system it claimed to display.
 *  - It published an exact per-wallet total for every wallet, which
 *    docs/points-system.md §8 forbids during a season and
 *    20260801000100_points_system.sql:238-240 already said it forbade.
 *
 * It had zero consumers, which is the only reason none of that shipped as a bug.
 *
 * The rewrite reads `point_leaderboard` and nothing else. That view is the single
 * public surface and it does the masking itself, keyed on the season's own
 * `disclosure` tier — so this route cannot leak by forgetting, and neither can the
 * next caller somebody writes. The anon client is used deliberately: after
 * 20260817000000, `point_balances` is service-role-only and the view is granted to
 * anon, so a route holding the service key here would be claiming a privilege the
 * surface it publishes does not need.
 */

import { NextResponse, type NextRequest } from "next/server";

import { supabase } from "@/lib/supabase/supabaseClient";
import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";
import type {
  LeaderboardPayload,
  LeaderboardRow,
  LeaderboardSeason,
  LeaderboardSeasonRef,
} from "@/lib/points/leaderboard";

export const dynamic = "force-dynamic";

/**
 * Read the board through the service-role client, not anon.
 *
 * The anon path was observed serving a stale copy of the database from
 * production (Season 0 / 0 ranked) while the primary held the real data —
 * a read-replica the app's functions were routed to. The service-role
 * client reads the primary (the waitlist board, which uses it, stayed
 * fresh throughout), so it is the reliable source. This does NOT widen what
 * is exposed: the route still reads only point_leaderboard, and that view
 * does all the disclosure masking itself keyed on the season tier — the key
 * changes who the DB serves, not what the view returns. Falls back to the
 * anon client when no service key is configured (dev), so nothing breaks.
 */
const db = isAdminConfigured && supabaseAdmin ? supabaseAdmin : supabase;

/**
 * Fixed page size. The board is paginated: each request returns one PAGE_SIZE
 * slice of the full ranked list (`?page=`, 0-based) ordered by rank then wallet,
 * rather than one capped response. `participants` (the exact unflagged total)
 * drives how many pages exist. The final sort on `wallet` is what keeps the
 * slices non-overlapping when many wallets share a rank.
 */
const PAGE_SIZE = 100;

/** Columns as PostgREST spells them; the view is snake_case like its base table. */
const ROW_COLUMNS =
  "wallet, rank, percentile, total, time_points, action_points, bonus_points, volume";

interface SeasonRecord {
  id: number;
  label: string;
  starts_at: string;
  ends_at: string | null;
  frozen_at: string | null;
  converts_to_tokens: boolean;
  disclosure: LeaderboardSeason["disclosure"];
  public_rank_limit: number;
  is_default: boolean;
}

interface RowRecord {
  wallet: string;
  rank: number | null;
  percentile: number | null;
  total: number | string | null;
  time_points: number | string | null;
  action_points: number | string | null;
  bonus_points: number | string | null;
  volume: number | string | null;
}

/**
 * Postgres `numeric` arrives as a STRING over PostgREST, not a number — the
 * driver refuses to silently round a value that may not fit a double, which is
 * the same hazard `kaleido_listings.amount` documents from the other direction.
 * Point totals are small enough to be exact in float64, so parsing is safe here;
 * what is not safe is assuming the wire already gave us a number.
 */
function num(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The season to show. `?season=` wins; otherwise the one flagged `is_default`.
 *
 * There is deliberately no fallback beyond that. 20260817000000 chose an explicit
 * flag over "highest id where frozen_at is null" or "latest starts_at" because
 * both infer a product decision from a timestamp — so guessing here would
 * reintroduce exactly what that column exists to prevent. No default season is an
 * operator error, and it should read as one.
 */
async function resolveSeason(requested: number | null): Promise<{
  season: SeasonRecord | null;
  error: string | null;
  /** The query succeeded and matched nothing — the caller named a season that
      is not there, which is not a fault of this route. */
  notFound?: true;
}> {
  const columns =
    "id, label, starts_at, ends_at, frozen_at, converts_to_tokens, disclosure, public_rank_limit, is_default";

  const query =
    requested === null
      ? db.from("point_seasons").select(columns).eq("is_default", true)
      : db.from("point_seasons").select(columns).eq("id", requested);

  const { data, error } = await query.maybeSingle<SeasonRecord>();

  if (error) {
    console.error("[leaderboard] season read failed:", error.message);
    return { season: null, error: "Could not read the season registry" };
  }
  if (!data) {
    /* Two quite different faults reach this branch and they get different
       answers. A season the caller asked for by id and that is not there is the
       caller's mistake. No default season at all is an operator error — the note
       above says it should read as one — so it keeps the 500. */
    if (requested !== null)
      return {
        season: null,
        error: `Season ${requested} does not exist`,
        notFound: true,
      };
    return { season: null, error: "No season is marked as default" };
  }
  return { season: data, error: null };
}

async function computeBoard(
  seasonId: number | null,
  page: number,
): Promise<{
  payload: LeaderboardPayload | null;
  error: string | null;
  notFound?: true;
}> {
  const {
    season,
    error: seasonError,
    notFound,
  } = await resolveSeason(seasonId);
  if (!season) return { payload: null, error: seasonError, notFound };

  /* The page's slice of the full ranked list. There is no per-tier row ceiling
     any more: the season's disclosure decides what each row REVEALS (the view
     masks total and rank), not how many rows exist, and the list is walked a
     page at a time. */
  const offset = page * PAGE_SIZE;

  const degraded: string[] = [];

  const [rows, count, seasons] = await Promise.all([
    /*
     * Ordered by rank, not by total: `total` is NULL at the rank_only tier, and
     * ordering by a masked column would make the sequence undefined for exactly
     * the season that most needs it to be stable. `percentile` breaks ties and is
     * never masked. nullsFirst is off so that if a null rank ever does reach this
     * slice it lands at the bottom instead of the top.
     */
    db
      .from("point_leaderboard")
      .select(ROW_COLUMNS)
      .eq("season", season.id)
      .order("rank", { ascending: true, nullsFirst: false })
      .order("percentile", { ascending: true })
      .order("wallet", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1),
    /*
     * The percentile denominator, read exactly rather than taken from
     * `rows.length`. Those two agree only while the board is shorter than the
     * limit, and "top 12%" computed against a truncated population is a wrong
     * number that looks right.
     */
    db
      .from("point_leaderboard")
      .select("wallet", { count: "exact", head: true })
      .eq("season", season.id),
    /*
     * The selector's options. A separate read from `resolveSeason` rather than
     * one query filtered in memory: that one has to return exactly one row and
     * fail loudly when it does not, and folding the two together would turn "no
     * default season" — an operator error §8's tiering depends on catching — into
     * a list this route quietly picked the first entry from.
     */
    db
      .from("point_seasons")
      .select("id, label, frozen_at")
      .order("id", { ascending: true }),
  ]);

  if (rows.error) {
    console.error("[leaderboard] rows read failed:", rows.error.message);
    degraded.push("rows");
  }
  if (count.error) {
    console.error("[leaderboard] count read failed:", count.error.message);
  }
  if (seasons.error) {
    console.error("[leaderboard] seasons read failed:", seasons.error.message);
    degraded.push("seasons");
  }

  /* PostgREST returns the count in a Content-Range header, so a proxy that strips
     it leaves `count` null with no error beside it. Naming the leg either way
     keeps a null from reading as "still loading". */
  const participants = count.error ? null : (count.count ?? null);
  if (participants === null) degraded.push("participants");

  const mapped: LeaderboardRow[] = ((rows.data ?? []) as RowRecord[]).map(
    (r) => ({
      wallet: r.wallet,
      rank: r.rank,
      percentile: r.percentile,
      total: num(r.total),
      timePoints: num(r.time_points),
      actionPoints: num(r.action_points),
      bonusPoints: num(r.bonus_points),
      volume: num(r.volume),
    }),
  );

  const seasonOut: LeaderboardSeason = {
    id: season.id,
    label: season.label,
    disclosure: season.disclosure,
    publicRankLimit: season.public_rank_limit,
    startsAt: season.starts_at,
    endsAt: season.ends_at,
    frozenAt: season.frozen_at,
    convertsToTokens: season.converts_to_tokens,
    isDefault: season.is_default,
  };

  /* Falls back to the resolved season alone rather than an empty array: a
     selector with one option is a label, and a selector with none is a page that
     cannot say which season it is showing. */
  const seasonRefs: LeaderboardSeasonRef[] = seasons.error
    ? [{ id: season.id, label: season.label, frozenAt: season.frozen_at }]
    : (
        (seasons.data ?? []) as {
          id: number;
          label: string;
          frozen_at: string | null;
        }[]
      ).map((r) => ({ id: r.id, label: r.label, frozenAt: r.frozen_at }));

  return {
    payload: {
      season: seasonOut,
      seasons: seasonRefs,
      rows: mapped,
      participants,
      truncated: participants !== null && participants > offset + mapped.length,
      page,
      pageSize: PAGE_SIZE,
      asOf: new Date().toISOString(),
      degraded,
    },
    error: null,
  };
}

/* ------------------------------------------------------------- caching -- */

/**
 * Process-local cache, keyed and bounded — the same shape as
 * api/prices/route.ts:48-62, which is keyed for the same reason: this route takes
 * parameters, so a single-entry cache would thrash between seasons.
 *
 * The key is (season, limit) and contains NO wallet. That is load-bearing rather
 * than incidental: a per-caller value in a shared process cache is how one
 * visitor ends up served another's row. The self-lookup surface is a separate,
 * uncached route for exactly that reason.
 */
interface Cached {
  at: number;
  payload: LeaderboardPayload;
}

const TTL_MS = 60_000;
const MAX_KEYS = 32;
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<LeaderboardPayload>>();

function store(key: string, payload: LeaderboardPayload) {
  if (cache.size >= MAX_KEYS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), payload });
}

/**
 * A season the caller named that is not in the registry.
 *
 * Carried as its own type rather than folded into the generic failure because
 * the difference is not cosmetic. `[leaderboard] failed:` beside a 500 is how a
 * broken read announces itself, and a schema genuinely missing seven columns hid
 * behind an error of that shape for the whole life of this route — a client
 * typing `?season=99` must not be able to write the same line. This one answers
 * 404 and logs nothing.
 */
class SeasonNotFound extends Error {
  readonly status = 404;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const rawSeason = searchParams.get("season");
  const seasonId =
    rawSeason === null || rawSeason.trim() === "" ? null : Number(rawSeason);
  /* Season 0 is a real season, so `Number("0")` must not be rejected as falsy —
     and a non-integer must not become a silent default, which would answer a
     question the caller did not ask. */
  if (seasonId !== null && !Number.isInteger(seasonId)) {
    return NextResponse.json(
      { success: false, error: "season must be an integer" },
      { status: 400 },
    );
  }

  /* Pagination: `?page=` is 0-based, each page is PAGE_SIZE rows. A non-integer
     or negative page is treated as page 0 rather than answering a question the
     caller did not ask. */
  const rawPage = Number(searchParams.get("page") ?? 0);
  const page =
    Number.isFinite(rawPage) && rawPage > 0 ? Math.trunc(rawPage) : 0;

  const key = `${seasonId ?? "default"}|p${page}`;
  const forceRefresh = searchParams.has("refresh");

  const hit = cache.get(key);
  if (!forceRefresh && hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json(
      { success: true, data: hit.payload, stale: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = computeBoard(seasonId, page).then(
      ({ payload, error, notFound }) => {
        if (!payload) {
          const message = error ?? "leaderboard unavailable";
          throw notFound ? new SeasonNotFound(message) : new Error(message);
        }
        store(key, payload);
        return payload;
      },
    );
    inflight.set(key, pending);
    void pending.catch(() => {}).finally(() => inflight.delete(key));
  }

  try {
    const payload = await pending;
    return NextResponse.json(
      { success: true, data: payload, stale: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    /* A named season that is not there is answered before the stale fallback is
       considered: serving another season's cached board under the id the caller
       asked for would attribute a ranking to a season that does not exist. */
    if (err instanceof SeasonNotFound) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: err.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    /* Serve the last good board rather than nothing, flagged stale so the page can
       label it. With nothing cached this is a 500 — an empty board is honest, and
       there is no zero to fall back to that would not be a claim about ranking. */
    if (hit) {
      console.error("[leaderboard] recompute failed, serving stale:", err);
      return NextResponse.json(
        { success: true, data: hit.payload, stale: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("[leaderboard] failed:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Leaderboard unavailable",
      },
      { status: 500 },
    );
  }
}
