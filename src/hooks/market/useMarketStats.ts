"use client";

/**
 * Headline figures for the protocol stat strips.
 *
 * Two consumers: /leaderboard's strip, and the Borrow/Lend shell's, which reads
 * the lending fields of the same response. A thin fetch of
 * `/api/market/overview`, which is where the arithmetic now lives. It used to be
 * here, and every number it produced was wrong:
 *
 *  - `Number(item.amount)` on a base-unit TEXT column, summed across tokens
 *    with different decimals and no price conversion. A 1 USDC offer and a
 *    1 ETH offer added to 1000000000001000000 and rendered as
 *    "$1,000,000,000,001,000,000". The route's docstring covers why the column
 *    is text and why this could not be fixed in the browser.
 *  - A "Revenue" figure computed as `volume * 0.003`. That is Uniswap's swap
 *    fee applied to lending volume; Kaleido charges no 0.3% fee anywhere. The
 *    tile is gone rather than corrected, because accrued protocol revenue is
 *    not derivable from the mirror tables at all.
 *  - A `catch` that logged and left state alone while `loading` went false, so
 *    an unreachable database rendered as a measured "$0".
 *
 * Fields are nullable now, and the strip renders null as an em dash. `coverage`
 * travels with them so the page can say what a total excludes instead of
 * quietly dropping rows from it.
 */

import { useCallback, useEffect, useState } from "react";

/* Types come from lib/market/bookValue, not from the route that serves them.
 * `import type` erases at compile time, but a route module is not something a
 * client bundle should be able to name at all — the shared shape belongs in the
 * library both sides import. */
import type { MarketCoverage, MarketOverview } from "@/lib/market/bookValue";
import { MOCK_DATA, MOCK_MARKET } from "@/lib/mock";

export type { MarketCoverage, MarketOverview };

export interface MarketStatsState {
  stats: MarketOverview | null;
  loading: boolean;
  /** Set when the fetch itself failed, as distinct from a leg being degraded. */
  error: string | null;
  /** True when the route served its last good figures after a failed recompute. */
  stale: boolean;
}

const REFRESH_MS = 60_000;

export const useMarketStats = () => {
  const [state, setState] = useState<MarketStatsState>({
    stats: null,
    loading: true,
    error: null,
    stale: false,
  });

  const load = useCallback(async (signal: AbortSignal) => {
    /* Fixture figures, before the fetch. The mirror tables are empty, so every
       tile on /leaderboard and on all four Borrow/Lend tabs renders an em dash
       under "No positions indexed yet". MOCK_MARKET is not typed-in: it folds
       ./mock/lending's own book through the same `foldBook`/`valueBook` the route
       uses, so the strip and the table below it cannot disagree. Deleting ./mock
       deletes this block. */
    if (MOCK_DATA) {
      if (signal.aborted) return;
      setState({
        stats: MOCK_MARKET,
        loading: false,
        error: null,
        stale: false,
      });
      return;
    }
    try {
      const res = await fetch("/api/market/overview", {
        signal,
        cache: "no-store",
      });
      const body = await res.json();

      if (!res.ok || !body?.success) {
        throw new Error(body?.details || body?.error || `HTTP ${res.status}`);
      }

      if (signal.aborted) return;
      setState({
        stats: body.data as MarketOverview,
        loading: false,
        error: null,
        stale: Boolean(body.stale),
      });
    } catch (err) {
      if (signal.aborted) return;
      /* Keep whatever was last shown rather than blanking a populated strip on
       * one bad poll, but surface the error and never leave a stale figure
       * looking fresh. `stats` stays null on a first-load failure, which is what
       * makes the tiles render "—" instead of "$0". */
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[useMarketStats]", message);
      setState((prev) => ({
        stats: prev.stats,
        loading: false,
        error: message,
        stale: prev.stats !== null,
      }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
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
};

/* ------------------------------------------------ describing what is missing -- */

/*
 * `coverageNote` and `degradedNote` were here, and both are gone.
 *
 * They turned this payload's `coverage` block and its `degraded` list into a
 * sub-line for a stat tile: "No positions indexed yet", "Excludes 3 unpriced of 17
 * positions", "Unavailable". Nothing renders a sub-line under a stat any more — see
 * the note in components/v2/StatStrip.tsx for why the 2×2 phone grid could not
 * carry a sentence per tile — so both helpers lost their only callers.
 *
 * `degraded` and `coverage` are still on the payload and still worth reading. What
 * they no longer have is a *presentation* here, and that is the deliberate part: a
 * caveat wants the width of a table row, not a quarter of a phone screen. Anything
 * new that needs to say "this figure is incomplete" should format it at the surface
 * that has room, rather than reviving a shared one-liner that only fit one shape.
 */
