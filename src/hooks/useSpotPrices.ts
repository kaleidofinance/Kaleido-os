"use client";

import { useEffect, useState } from "react";
import {
  fetchSpotPrices,
  priceLookup,
  type PriceLookup,
  type SpotPrices,
} from "@/lib/market/spot";
import { MOCK_DATA } from "@/lib/mock";
import { MOCK_USD } from "@/lib/mock/quotes";

/**
 * Spot USD prices for a component tree.
 *
 * `lib/market/spot.ts` already holds the wire shape, the fetch and the lookup;
 * the only thing missing was a React entry point. The two existing consumers
 * (`usePoolData`, `useV3Pools`) call `priceLookup(await fetchSpotPrices())`
 * inside a module-scope sweep, so neither needed one. /portfolio does: it prices
 * wallet balances, stable positions and LP legs from the same table, and it has
 * to re-render when the table lands rather than baking prices into a sweep.
 *
 * WHY A SHARED CACHE AND NOT ONE FETCH PER HOOK
 *
 * Every mount would otherwise cost a request, and React's development
 * double-effect makes that two. The cache is module scope with a TTL, plus an
 * in-flight promise so concurrent mounts join the same request instead of
 * racing. This is the same shape `usePoolData`'s store uses, for the same
 * reason, and it is why several groups on one page can each ask for prices
 * without the page making several calls.
 *
 * WHAT A NULL PRICE MEANS
 *
 * `priceOf` returns null for any symbol the table has no price for — USDe has no
 * feed, and KLD and stKLD have no market before TGE. A caller must render that
 * as unknown, never as zero: a position worth an unknown amount is not a
 * position worth nothing, and summing it as 0 understates a portfolio total
 * while looking like a confident measurement. `asOf` is exposed so a stale serve
 * can be shown rather than trusted silently.
 */

/** How long a fetched table is reused before another mount refetches it. */
const TTL_MS = 60_000;
/** How often a mounted hook refreshes on its own. */
const REFRESH_MS = 60_000;

interface Cached {
  prices: SpotPrices | null;
  at: number;
}

let cache: Cached | null = null;
let inFlight: Promise<SpotPrices | null> | null = null;

/**
 * The fetch every consumer shares.
 *
 * `Date.now()` rather than a passed clock because this is browser-only cache
 * bookkeeping, not a value that reaches the screen — nothing here is rendered or
 * snapshotted, so there is nothing for a fixed clock to make reproducible.
 */
async function load(force: boolean): Promise<SpotPrices | null> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.prices;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      /* No signal: this promise is shared, so one unmounting consumer aborting
         it would blank the table for every other consumer still waiting. The
         hook drops the result instead if it unmounted first. */
      const prices = await fetchSpotPrices();
      /* A failed fetch is cached too, and deliberately: without that, a page
         whose feed is down retries on every mount and every refresh tick. The
         TTL is short enough that recovery is a minute away. */
      cache = { prices, at: Date.now() };
      return prices;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export interface SpotPricesState {
  /** Symbol → USD, or null when the table has no price for it. */
  priceOf: PriceLookup;
  /** When the prices were computed, or null before the first read lands. */
  asOf: string | null;
  /** True until the first read settles — success or failure. */
  loading: boolean;
}

export function useSpotPrices(): SpotPricesState {
  /* Seeded from the cache, so a second consumer on the same page renders priced
     on its first paint instead of flashing em dashes. */
  const seed = cache && Date.now() - cache.at < TTL_MS ? cache.prices : null;
  const [prices, setPrices] = useState<SpotPrices | null>(seed);
  const [loading, setLoading] = useState(seed === null);

  useEffect(() => {
    /* The fixture table, so a mocked portfolio values an ether at the same price
       the mocked swap card and pool table do — ./quotes is where that number
       lives. Delete with src/lib/mock. */
    if (MOCK_DATA) {
      setPrices({ usd: MOCK_USD, asOf: "2026-08-19T08:00:00.000Z" });
      setLoading(false);
      return;
    }

    let live = true;

    const run = async (force: boolean) => {
      const next = await load(force);
      if (!live) return;
      setPrices(next);
      setLoading(false);
    };

    void run(false);
    const timer = setInterval(() => void run(true), REFRESH_MS);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return {
    /* Rebuilt on every render rather than memoised: `priceLookup` builds one
       lowercase Map over a table of a dozen symbols, and memoising it would tie
       every consumer's identity to a dependency array for no measurable gain. */
    priceOf: priceLookup(prices),
    asOf: prices?.asOf ?? null,
    loading,
  };
}
