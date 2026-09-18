"use client";

/**
 * Leaderboard — points standings, one season at a time.
 *
 * Replaces /explore, and inherits its three protocol tiles because they were the
 * only thing left on that page after both of its tables moved to /pool.
 *
 * WHAT THIS PAGE DOES NOT SHOW, AND WHY NOT
 *
 * The ask was rank, points, transaction count, and per-wallet volume over 24h,
 * 7d and 30d. Rank and points are here. The other two are not, and the reason is
 * the same for both.
 *
 * `point_source_rates` is public-read and Season 1's swap rate is 1.0 points per
 * USD of transaction value, so a published point total divided by a published
 * rate IS a published USD volume. A volume column is therefore not a different
 * disclosure from the points column — it is the same one, spelled in dollars,
 * and docs/points-system.md §8 states it in four words: "Never publish USD
 * position sizes." A public wallet-to-amount map is a phishing and MEV target
 * list. That is also why the Transactions table that used to sit on /explore was
 * retired rather than moved.
 *
 * Windowed volume is additionally not derivable. `kaleido_protocol_activity`
 * holds the only per-wallet volume figure in the schema and
 * kaleido_core_tables.sql:127 records that its `amountInUsd` is a raw token
 * amount in some rows and dollars in others — a 1,000 USDC swap and a 0.5 ETH
 * swap score 1,000 and 0.5. There is no 7d or 30d aggregate anywhere to correct.
 * The DEX side samples a block window and gives 24h only.
 *
 * What replaces them honestly is the point total itself, which is already
 * volume-weighted by construction, plus the protocol-wide tiles in the strip.
 * Per-wallet volume becomes publishable at `disclosure = 'full'`, which is what
 * the freeze is for — everything is published then, for audit and dispute.
 */

import { useMemo, useState } from "react";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";

import Nav from "@/components/v2/Nav";
import { Stat, StatStrip } from "@/components/v2/StatStrip";
import { useLeaderboard, useStanding } from "@/hooks/points/useLeaderboard";
import { DASH, qty } from "@/lib/format/figures";
import type {
  LeaderboardPayload,
  LeaderboardRow,
} from "@/lib/points/leaderboard";
import s from "./leaderboard.module.css";

/** Enough of an address to recognise, on a page that is a list of them. */
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * What goes in the rank column.
 *
 * Two different things share it. The top of the board has an exact rank; past
 * `public_rank_limit` the view masks it to null and §8 gives the long tail a
 * percentile instead — "top 12%", not "#4,832". Both are the answer to "where am
 * I", so they belong in one column rather than in two of which one is always
 * blank.
 */
function rankText(row: LeaderboardRow): string {
  if (row.rank !== null) return `#${row.rank}`;
  if (row.percentile !== null) return `Top ${row.percentile}%`;
  return DASH;
}

/** Points, formatted. Null means the tier withholds it, not that it is zero. */
const points = (n: number | null) => qty(n);

/**
 * The footnote that explains a missing column.
 *
 * Written from the tier rather than hardcoded per page, so a season switched to
 * `totals` or frozen to `full` explains itself without an edit here.
 */
function tierNote(payload: LeaderboardPayload): string {
  const { disclosure, publicRankLimit } = payload.season;
  if (disclosure === "full") {
    return "Frozen and published in full: every wallet, its rank, and its score breakdown.";
  }
  const tail = `Exact ranks for the top ${publicRankLimit}; a percentile band below.`;
  if (disclosure === "totals") {
    return `${tail} Score breakdowns stay private until the season freezes.`;
  }
  return `${tail} Totals stay private while the season runs.`;
}

export default function LeaderboardPage() {
  /* null means "whichever season is flagged is_default" — the route resolves it,
     and the answer comes back in the payload. Not seeded from the default's id
     here, because that would be this page guessing at a product decision the
     schema records. */
  const [season, setSeason] = useState<number | null>(null);

  const board = useLeaderboard(season);
  const { address } = useWalletV2();
  const wallet = address?.toLowerCase() ?? null;

  const payload = board.payload;
  const resolvedSeason = payload?.season.id ?? null;
  const standing = useStanding(wallet, resolvedSeason);

  const rows = payload?.rows ?? [];
  const full = payload?.season.disclosure === "full";
  const frozen = Boolean(payload?.season.frozenAt);

  /* The connected wallet's own figures, folded into the stat strip below (was
     a second card). Own points are shown even at the rank_only tier: a wallet
     reading its OWN total is its own data, not the public total §8 withholds. */
  const myRow = standing.standing?.row ?? null;
  const myStanding = !wallet
    ? DASH
    : standing.loading || standing.error
      ? DASH
      : myRow
        ? rankText(myRow)
        : "Unranked";
  const myPoints = wallet && myRow ? points(myRow.total) : DASH;
  const myNote = !wallet
    ? "Connect a wallet to see your standing."
    : standing.error
      ? `Your standing could not be read: ${standing.error}`
      : !standing.loading && !myRow
        ? "No points in this season yet."
        : null;

  /* Five extra columns at `full`, two otherwise. The tier decides the grid, so
     the template lives in a class name rather than in inline styles. */
  const gridClass = full ? s.t5 : s.t2;

  const notes = useMemo(() => {
    if (!payload) return [];
    const out: string[] = [tierNote(payload)];

    if (payload.truncated && payload.participants !== null) {
      out.push(
        `Showing ${rows.length} of ${payload.participants} ranked wallets.`,
      );
    }
    if (payload.degraded.length > 0) {
      out.push(
        `Some reads failed, shown as ${DASH}: ${payload.degraded.join(", ")} — a missing read, not a zero.`,
      );
    }
    if (board.stale) {
      out.push(
        "These are the last figures that loaded successfully; the most recent refresh failed.",
      );
    }
    if (!payload.season.convertsToTokens) {
      out.push(
        "This season doesn't convert to tokens.",
      );
    }
    return out;
  }, [payload, rows.length, board.stale]);

  return (
    <>
      <Nav />
      <main className={s.wrap}>
        <div className={s.head}>
          <h1 className={s.h1}>Leaderboard</h1>

          {payload ? (
            <>
              <span className={s.chip}>
                <span className={`${s.dot} ${frozen ? "" : s.dotLive}`} />
                {frozen ? "Frozen" : "Live"}
              </span>
              {/* The tier, said out loud. Every blank column on this page follows
                  from it, and a reader who cannot see it has no way to tell a
                  withheld figure from a broken one. */}
              <span className={s.chip}>
                {payload.season.disclosure === "rank_only"
                  ? "Ranks only"
                  : payload.season.disclosure === "totals"
                    ? "Ranks and totals"
                    : "Full disclosure"}
              </span>
            </>
          ) : null}

          <span className={s.spacer} />

          {payload && payload.seasons.length > 1 ? (
            <select
              className={s.seasonPick}
              aria-label="Season"
              value={payload.season.id}
              onChange={(e) => setSeason(Number(e.target.value))}
            >
              {payload.seasons.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                  {x.frozenAt ? " · frozen" : ""}
                </option>
              ))}
            </select>
          ) : payload ? (
            <span className={s.chip}>{payload.season.label}</span>
          ) : null}
        </div>

        {/* Points-scoped stats only. This strip used to also carry three
            protocol-wide figures (Lending TVL, kfUSD supply, KLD staked) carried
            over from the old /explore page; they rank nothing and don't belong on
            a points leaderboard, so they were removed (a protocol/analytics
            surface is their home). Season totals stay private at the rank_only
            tier, so the honest points headline is the ranked-wallet count and the
            season it is scoped to. */}
        {/* One card: the board headline figures + the connected wallet's own
            standing, merged from two strips into one. */}
        <StatStrip>
          <Stat label="Wallets ranked" value={qty(payload?.participants)} />
          <Stat label="Season" value={payload?.season.label ?? DASH} />
          <Stat label="Your standing" value={myStanding} />
          <Stat label="Your points" value={myPoints} />
        </StatStrip>
        {myNote ? <p className={s.stripNote}>{myNote}</p> : null}

        <div className={`${s.table} ${gridClass}`}>
          <div className={s.thead}>
            <span>Rank</span>
            <span>Wallet</span>
            <span className={s.right}>Points</span>
            {full ? (
              <>
                <span className={s.right}>Time</span>
                <span className={s.right}>Action</span>
                <span className={s.right}>Bonus</span>
              </>
            ) : null}
          </div>

          {board.loading && rows.length === 0 ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={s.rowSkeleton}>
                <span className={s.skLine} />
              </div>
            ))
          ) : board.error && rows.length === 0 ? (
            <div className={s.tEmpty}>
              <b>The board could not be loaded</b>
              {board.error}
            </div>
          ) : rows.length === 0 ? (
            /* Why, not just "no results". An empty board has three quite
               different causes and the reader cannot distinguish them: a season
               that has not started accruing, a points runtime that does not exist
               yet (§11), or migrations that have not been pushed. */
            <div className={s.tEmpty}>
              <b>Nobody is ranked in this season yet</b>
              No points credited to this season yet.
            </div>
          ) : (
            rows.map((r) => {
              const mine = wallet !== null && r.wallet.toLowerCase() === wallet;
              return (
                <div
                  key={r.wallet}
                  className={`${s.row} ${mine ? s.rowYou : ""}`}
                >
                  <span
                    className={r.rank !== null ? s.rankTop : s.rank}
                    /* The masked case needs saying: a percentile where a
                       neighbour has a number looks like a missing number. */
                    title={
                      r.rank === null
                        ? "Exact rank is published for the top ranks only"
                        : undefined
                    }
                  >
                    {rankText(r)}
                  </span>
                  <span className={`${s.addr} tabular`}>
                    {short(r.wallet)}
                    {mine ? <span className={s.youTag}>You</span> : null}
                  </span>
                  <span className={`${s.right} tabular`}>
                    {points(r.total)}
                  </span>
                  {full ? (
                    <>
                      <span className={`${s.right} tabular`}>
                        {points(r.timePoints)}
                      </span>
                      <span className={`${s.right} tabular`}>
                        {points(r.actionPoints)}
                      </span>
                      <span className={`${s.right} tabular`}>
                        {points(r.bonusPoints)}
                      </span>
                    </>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {notes.length > 0 ? (
          <div className={s.notes}>
            {notes.map((n, i) => (
              <span key={i}>{n}</span>
            ))}
          </div>
        ) : null}
      </main>
    </>
  );
}
