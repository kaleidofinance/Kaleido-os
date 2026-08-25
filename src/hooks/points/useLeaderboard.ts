"use client";

/**
 * Reads for the /leaderboard page.
 *
 * Two hooks rather than one, because the two fetches have genuinely different
 * lifetimes and the routes behind them are split for the same reason: the board
 * is identical for every visitor and cached for a minute, while a wallet's own
 * standing is per-caller and uncached. Folding them into one hook would give the
 * page a single `loading` flag covering both, and the board would then be held
 * back from rendering by a request that only concerns one row of it.
 *
 * Both are thin fetches. Nothing is computed here — a rank computed in the
 * browser is the class of bug docs/points-system.md §1 opens with, and the
 * masking these figures carry is enforced in `point_leaderboard`, not in
 * TypeScript.
 */

import { useCallback, useEffect, useState } from "react";

import { MOCK_DATA, mockLeaderboard, mockStanding } from "@/lib/mock";
import type {
  LeaderboardPayload,
  LeaderboardStanding,
} from "@/lib/points/leaderboard";

/** Long, on purpose: the board's own cache is 60s, so anything shorter would
    poll a route that returns the same bytes. Points accrue per epoch, not per
    block — there is nothing here that moves in a minute. */
const REFRESH_MS = 120_000;

export interface LeaderboardState {
  payload: LeaderboardPayload | null;
  loading: boolean;
  error: string | null;
  /** The route served its last good board after a failed recompute. */
  stale: boolean;
}

/**
 * @param season Explicit season, or null for the one flagged `is_default`.
 */
export function useLeaderboard(season: number | null): LeaderboardState {
  const [state, setState] = useState<LeaderboardState>({
    payload: null,
    loading: true,
    error: null,
    stale: false,
  });

  const load = useCallback(
    async (signal: AbortSignal) => {
      /* Fixture board, before the fetch: nothing has ever written to
         `point_balances`, so the real route answers with an empty rows array and
         the page renders "Nobody is ranked in this season yet". Substituted here
         rather than in the route because /api/leaderboard is also the thing an
         indexer will be checked against, and a route that lies has no honest
         caller left. `signal` is deliberately still honoured — a season switch
         must not commit the previous season's board. Deleting ./mock deletes this
         block. */
      if (MOCK_DATA) {
        if (signal.aborted) return;
        setState({
          payload: mockLeaderboard(season),
          loading: false,
          error: null,
          stale: false,
        });
        return;
      }
      const qs = season === null ? "" : `?season=${season}`;
      try {
        const res = await fetch(`/api/leaderboard${qs}`, {
          signal,
          cache: "no-store",
        });
        const body = await res.json();
        if (!res.ok || !body?.success) {
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        if (signal.aborted) return;
        setState({
          payload: body.data as LeaderboardPayload,
          loading: false,
          error: null,
          stale: Boolean(body.stale),
        });
      } catch (err) {
        if (signal.aborted) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[useLeaderboard]", message);
        /* Keep the last good board rather than blanking a populated table on one
           bad poll — but never leave it looking fresh. On a first-load failure
           `payload` stays null, which is what makes the page render its "could
           not load" state instead of an empty board, and an empty board is a
           claim: it says nobody has any points. */
        setState((prev) => ({
          payload: prev.payload,
          loading: false,
          error: message,
          stale: prev.payload !== null,
        }));
      }
    },
    [season],
  );

  useEffect(() => {
    const controller = new AbortController();
    /* Blank the previous season's rows on switch. Without this the old table
       stays on screen under the new season's header for as long as the fetch
       takes, which is a board attributed to the wrong season. */
    setState((prev) => ({ ...prev, loading: true }));
    load(controller.signal);

    const interval = setInterval(() => {
      if (!controller.signal.aborted) load(controller.signal);
    }, REFRESH_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [load]);

  return state;
}

export interface StandingState {
  standing: LeaderboardStanding | null;
  loading: boolean;
  error: string | null;
}

/**
 * One wallet's row. Skipped entirely when either argument is missing — no wallet
 * connected, or the board has not resolved its season yet.
 *
 * `season` is required by the route rather than defaulted, so this deliberately
 * takes the season the board resolved instead of resolving one itself. A
 * standing card that had asked a second time could end up describing a different
 * season than the table beside it.
 */
export function useStanding(
  wallet: string | null | undefined,
  season: number | null,
): StandingState {
  const [state, setState] = useState<StandingState>({
    standing: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!wallet || season === null) {
      setState({ standing: null, loading: false, error: null });
      return;
    }
    /* Fixture standing. After the guard, so it inherits the hook's own scoping:
       no wallet and no resolved season still means no card, which is the state the
       page shows a visitor who has not connected. Nothing async here, so there is
       no controller to abort. Deleting ./mock deletes this block. */
    if (MOCK_DATA) {
      setState({
        standing: mockStanding(wallet, season),
        loading: false,
        error: null,
      });
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true }));

    (async () => {
      try {
        const res = await fetch(
          `/api/leaderboard/me?wallet=${encodeURIComponent(wallet)}&season=${season}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const body = await res.json();
        if (!res.ok || !body?.success) {
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        if (controller.signal.aborted) return;
        setState({
          standing: body.data as LeaderboardStanding,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[useStanding]", message);
        /* Cleared rather than kept. Unlike the board, this is one specific
           wallet's row: showing the previous wallet's standing after a switch
           would be showing the user someone else's. */
        setState({ standing: null, loading: false, error: message });
      }
    })();

    return () => controller.abort();
  }, [wallet, season]);

  return state;
}
