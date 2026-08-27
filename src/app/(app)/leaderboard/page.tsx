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
import { useActiveAccount } from "thirdweb/react";

import Nav from "@/components/v2/Nav";
import { Stat, StatStrip } from "@/components/v2/StatStrip";
import { useMarketStats } from "@/hooks/market/useMarketStats";
import { useLeaderboard, useStanding } from "@/hooks/points/useLeaderboard";
import { DASH, qty, usd } from "@/lib/format/figures";
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
    return "This season is frozen and published in full: every wallet, its exact rank, and the time, action and bonus components of its total. Published before any token moves, so an allocation can be audited and disputed.";
  }
  const tail = `Exact ranks are published for the top ${publicRankLimit}; everyone below that gets a percentile band.`;
  if (disclosure === "totals") {
    return `${tail} The time, action and bonus split of each total stays private until the season freezes.`;
  }
  return `${tail} Point totals stay private while the season is running — if the wallet at rank 50 visibly holds 48,000 points, everyone knows exactly how much to deposit to displace it. Rank and percentile keep the competition without publishing the threshold.`;
}

export default function LeaderboardPage() {
  /* null means "whichever season is flagged is_default" — the route resolves it,
     and the answer comes back in the payload. Not seeded from the default's id
     here, because that would be this page guessing at a product decision the
     schema records. */
  const [season, setSeason] = useState<number | null>(null);

  const board = useLeaderboard(season);
  const market = useMarketStats();
  const account = useActiveAccount();
  const wallet = account?.address?.toLowerCase() ?? null;

  const payload = board.payload;
  const resolvedSeason = payload?.season.id ?? null;
  const standing = useStanding(wallet, resolvedSeason);

  const { stats } = market;
  const rows = payload?.rows ?? [];
  const full = payload?.season.disclosure === "full";
  const frozen = Boolean(payload?.season.frozenAt);

  /* Five extra columns at `full`, two otherwise. The tier decides the grid, so
     the template lives in a class name rather than in inline styles. */
  const gridClass = full ? s.t5 : s.t2;

  const notes = useMemo(() => {
    if (!payload) return [];
    const out: string[] = [tierNote(payload)];

    if (payload.truncated && payload.participants !== null) {
      out.push(
        `Showing ${rows.length} of ${payload.participants} ranked wallets. A complete export is a separate surface and has to exist before any allocation is disputed.`,
      );
    }
    if (payload.degraded.length > 0) {
      out.push(
        `Some reads failed and are shown as ${DASH}: ${payload.degraded.join(", ")}. A dash here is a missing measurement, never a zero.`,
      );
    }
    if (board.stale) {
      out.push(
        "These are the last figures that loaded successfully; the most recent refresh failed.",
      );
    }
    if (!payload.season.convertsToTokens) {
      out.push(
        "This season does not convert to tokens. The points are a real record of participation; the allocation is not.",
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

        {/* Wallets ranked is season-scoped; the other three are protocol-wide and
            carried over from /explore, which had nothing else left on it. Every
            label names its own scope. KLD is counted in KLD, never dollars — it
            has no market price before TGE (lib/points/prices.ts:53-58).

            No `note` on any of the four. They carried one — "No positions indexed
            yet", "Unavailable", a coverage caveat — and on a phone the strip is a
            2×2 grid where those sentences wrapped to three and four lines each,
            making a tile mostly explanation and pushing the figures apart. The
            figure already says it: a dash reads as no data and $0 reads as zero.
            The degraded/coverage state is still on `market` if a tile ever needs
            to show it again. */}
        <StatStrip>
          <Stat label="Wallets ranked" value={qty(payload?.participants)} />
          <Stat label="Lending TVL" value={usd(stats?.lendingTvlUsd)} />
          <Stat label="kfUSD supply" value={qty(stats?.kfUsdSupply)} />
          <Stat label="KLD staked" value={qty(stats?.kldStaked)} />
        </StatStrip>

        <YourStanding
          connected={Boolean(wallet)}
          loading={standing.loading}
          error={standing.error}
          row={standing.standing?.row ?? null}
          tierWithholdsTotal={payload?.season.disclosure === "rank_only"}
        />

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
              Points accrue per epoch from verified on-chain activity. Nothing
              has been credited to this season so far.
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

/* -------------------------------------------------------- your standing -- */

/**
 * The connected wallet's own row.
 *
 * Reads the same masked view the table does, so it adds convenience rather than
 * privilege — see api/leaderboard/me, which explains why serving §8's stricter
 * tier 2 needs a signed message and does not have one yet. What it genuinely
 * adds is finding yourself without scrolling: past `public_rank_limit` a wallet
 * is not in the published slice at all, and its percentile is the only answer it
 * gets.
 */
function YourStanding({
  connected,
  loading,
  error,
  row,
  tierWithholdsTotal,
}: {
  connected: boolean;
  loading: boolean;
  error: string | null;
  row: LeaderboardRow | null;
  tierWithholdsTotal: boolean;
}) {
  if (!connected) {
    return (
      <div className={s.you}>
        <div className={s.youMain}>
          <span className={s.youLabel}>Your standing</span>
          <span className={s.youVal}>{DASH}</span>
        </div>
        {/* One clause. This was three sentences explaining that points are
            credited server-side and never by the browser — true, and a
            reassurance nobody had asked for yet, which on a phone rendered as a
            six-line wall next to a dash. What the card has to do here is say why
            it is empty and how to fill it. */}
        <span className={s.youNote}>Connect a wallet to see its rank.</span>
      </div>
    );
  }

  const value = loading
    ? DASH
    : error
      ? DASH
      : row
        ? rankText(row)
        : "Unranked";

  /* Terse, and only where the figure cannot speak for itself. An error has to be
     said out loud. The two ordinary cases say nothing at all, because the card
     already shows them — the rank is the value and the total is its own row —
     and the sentences that used to restate them ("Ranked in Season 1 with 1,240
     points", plus a paragraph on where points come from) were the bulk of the
     card's height on a phone. The withheld case keeps one clause: its total row
     is suppressed below, so without it a reader sees a rank and a missing number
     with no reason given. The no-row case stays deliberately vague about why —
     one of the two reasons is a sybil flag, and naming it would turn this lookup
     into a flag detector. */
  const note = error
    ? `Your standing could not be read: ${error}`
    : loading
      ? null
      : row
        ? tierWithholdsTotal
          ? "Point totals are private while the season runs."
          : null
        : "No points in this season yet.";

  return (
    <div className={s.you}>
      <div className={s.youMain}>
        <span className={s.youLabel}>Your standing</span>
        <span className={`${s.youVal} tabular`}>{value}</span>
      </div>
      {row && !tierWithholdsTotal ? (
        <div className={s.youMain}>
          <span className={s.youLabel}>Your points</span>
          <span className={`${s.youVal} tabular`}>{points(row.total)}</span>
        </div>
      ) : null}
      {note ? <span className={s.youNote}>{note}</span> : null}
    </div>
  );
}
