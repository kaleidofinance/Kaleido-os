import { NextResponse, type NextRequest } from "next/server";
import { supabase } from "@/lib/supabase/supabaseClient";
import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";
import type {
  LeaderboardPayload,
  LeaderboardRow,
  LeaderboardSeason,
} from "@/lib/points/leaderboard";

export const dynamic = "force-dynamic";
const db = isAdminConfigured && supabaseAdmin ? supabaseAdmin : supabase;
const PAGE_SIZE = 100;
const TTL_MS = 60_000;
const MAX_KEYS = 32;
const snapshotStale = (payload: LeaderboardPayload) =>
  Date.now() - Date.parse(payload.asOf) > 180_000;
const cache = new Map<string, { at: number; payload: LeaderboardPayload }>();
const inflight = new Map<string, Promise<LeaderboardPayload>>();

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

class SeasonNotFound extends Error {}
const num = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

async function computeBoard(
  seasonId: number | null,
  page: number,
): Promise<LeaderboardPayload> {
  // Resolve the season and selector from one tiny registry read.
  const { data: records, error: seasonError } = await db
    .from("point_seasons")
    .select(
      "id,label,starts_at,ends_at,frozen_at,converts_to_tokens,disclosure,public_rank_limit,is_default",
    )
    .order("id")
    .abortSignal(AbortSignal.timeout(8_000));
  if (seasonError) throw new Error("Could not read the season registry");
  const seasons = (records ?? []) as SeasonRecord[];
  const season = seasons.find((s) =>
    seasonId === null ? s.is_default : s.id === seasonId,
  );
  if (!season) {
    if (seasonId !== null)
      throw new SeasonNotFound(`Season ${seasonId} does not exist`);
    throw new Error("No season is marked as default");
  }
  const offset = page * PAGE_SIZE;
  const [rows, meta] = await Promise.all([
    db
      .from("reward_board_rows")
      .select(
        "wallet,rank,percentile,total,time_points,action_points,bonus_points,volume,referrals,as_of",
      )
      .eq("season", season.id)
      .order("position")
      .range(offset, offset + PAGE_SIZE - 1)
      .abortSignal(AbortSignal.timeout(8_000)),
    db
      .from("reward_read_metadata")
      .select("participants,as_of")
      .eq("id", 1)
      .abortSignal(AbortSignal.timeout(8_000))
      .single(),
  ]);
  // A failed read must never be cached as a successful empty board.
  if (rows.error || meta.error || !meta.data)
    throw new Error("Leaderboard data is temporarily unavailable");
  const participants = Number(meta.data.participants?.[String(season.id)] ?? 0);
  const mapped: LeaderboardRow[] = (rows.data ?? []).map((r) => ({
    wallet: r.wallet,
    rank: num(r.rank),
    percentile: num(r.percentile),
    total: num(r.total),
    timePoints: num(r.time_points),
    actionPoints: num(r.action_points),
    bonusPoints: num(r.bonus_points),
    volume: num(r.volume),
    referrals: num(r.referrals),
  }));
  return {
    season: {
      id: season.id,
      label: season.label,
      disclosure: season.disclosure,
      publicRankLimit: season.public_rank_limit,
      startsAt: season.starts_at,
      endsAt: season.ends_at,
      frozenAt: season.frozen_at,
      convertsToTokens: season.converts_to_tokens,
      isDefault: season.is_default,
    },
    seasons: seasons.map((s) => ({
      id: s.id,
      label: s.label,
      frozenAt: s.frozen_at,
    })),
    rows: mapped,
    participants,
    page,
    pageSize: PAGE_SIZE,
    truncated: participants > offset + mapped.length,
    asOf: meta.data.as_of,
    degraded: [],
  };
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const rawSeason = params.get("season");
  const season =
    rawSeason === null || rawSeason.trim() === "" ? null : Number(rawSeason);
  if (season !== null && !Number.isSafeInteger(season))
    return NextResponse.json(
      { success: false, error: "season must be an integer" },
      { status: 400 },
    );
  const rawPage = Number(params.get("page") ?? 0);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 0;
  const key = `${season ?? "default"}|p${page}`;
  const hit = cache.get(key);
  const headers = { "Cache-Control": "no-store" };
  // A public refresh flag cannot bypass caching and hammer the database.
  if (hit && Date.now() - hit.at < TTL_MS)
    return NextResponse.json(
      { success: true, data: hit.payload, stale: snapshotStale(hit.payload) },
      { headers },
    );
  let pending = inflight.get(key);
  if (!pending) {
    pending = computeBoard(season, page).then((payload) => {
      if (cache.size >= MAX_KEYS && !cache.has(key)) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { at: Date.now(), payload });
      return payload;
    });
    inflight.set(key, pending);
    void pending.catch(() => {}).finally(() => inflight.delete(key));
  }
  try {
    const payload = await pending;
    return NextResponse.json(
      { success: true, data: payload, stale: snapshotStale(payload) },
      { headers },
    );
  } catch (error) {
    if (error instanceof SeasonNotFound)
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404, headers },
      );
    console.error("[leaderboard] read failed:", error);
    if (hit)
      return NextResponse.json(
        { success: true, data: hit.payload, stale: true },
        { headers },
      );
    return NextResponse.json(
      {
        success: false,
        error: "Leaderboard data is temporarily unavailable; please retry",
      },
      { status: 503, headers: { ...headers, "Retry-After": "10" } },
    );
  }
}
