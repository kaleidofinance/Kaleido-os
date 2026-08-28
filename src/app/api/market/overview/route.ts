/**
 * Protocol-wide headline figures for the stat strips on /leaderboard and the
 * Borrow/Lend shell.
 *
 * This exists because the strip cannot be computed in the browser, for two
 * reasons that are both hard constraints rather than preferences:
 *
 *  1. `kaleido_listings.amount` and `kaleido_requests.amount` are **base-unit
 *     integers stored as TEXT**. The migration that created them
 *     (20260731000000_kaleido_core_tables.sql:19-25) says the text type is there
 *     precisely to stop this being read as a number: "18-decimal amounts run
 *     past 10^19 and overflow float64". The hook this route replaces did
 *     `Number(item.amount)` and summed across tokens, so a 1 USDC offer (1e6)
 *     and a 1 ETH offer (1e18) added to 1000000000001000000 and rendered as
 *     $1,000,000,000,001,000,000.
 *  2. Valuation lives in `@/lib/points/prices`, which throws on import in the
 *     browser (prices.ts:28-34) — a client-supplied price is a client-supplied
 *     dollar figure.
 *
 * The arithmetic itself is in `@/lib/market/bookValue`, which is pure and
 * tested (bookValue.test.ts). This file is only plumbing: read the rows, resolve
 * decimals, fetch prices, read two contracts, cache the result.
 *
 * What it deliberately does NOT do is substitute 0 for a number it could not
 * measure. Every field is nullable and a failed leg names itself in `degraded`,
 * following the precedent in useStablecoin.ts:607-618: a zero is a measurement,
 * and presenting an unreachable database as "$0 TVL" is a lie the reader has no
 * way to detect.
 */

import { NextResponse } from "next/server";

import { supabase } from "@/lib/supabase/supabaseClient";
import {
  borrowCurrencies,
  getContracts,
  stakingContracts,
} from "@/constants/registry";
import { readOnlyProvider, READ_ONLY_CHAIN_ID } from "@/config/provider";
import { getERC20Contract, getKLDVaultContract } from "@/config/contracts";
import { getPrices } from "@/lib/points/prices";
import {
  EMPTY_COVERAGE,
  foldBook,
  toWholeUnits,
  valueBook,
  type BookRow,
  type MarketCoverage,
  type MarketOverview,
} from "@/lib/market/bookValue";

export const dynamic = "force-dynamic";

/**
 * Decimals resolve through the read chain's lending-currency list rather than a
 * per-row `decimalsForAddress(chainId, address)`, and that is forced, not lazy:
 *
 *  - The mirror tables carry **no chainId column**, so a per-row chain-scoped
 *    lookup has nothing to key on.
 *  - `readOnlyProvider` is pinned to `READ_ONLY_CHAIN_ID`, the same chain the
 *    book was indexed from, so `borrowCurrencies(READ_ONLY_CHAIN_ID)` and the
 *    rows agree by construction.
 *
 * When a second chain is indexed this breaks — the fix is a chainId column on
 * the mirror tables and a per-row lookup, not a wider guess here.
 */
const CURRENCIES = borrowCurrencies(READ_ONLY_CHAIN_ID);

/**
 * An on-chain read that must not be able to hang the route.
 *
 * `readOnlyProvider` has no per-call deadline, so a black-holed RPC would leave
 * the request open until the platform killed it — and the strip would then show
 * nothing rather than the legs that did succeed.
 */
function withTimeout<T>(work: Promise<T>, label: string, ms = 8000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** The OPEN lending book, valued and counted, plus the count of funded loans. */
async function lendingLeg(): Promise<{
  usd: number | null;
  coverage: MarketCoverage;
  openOffers: number | null;
  openRequests: number | null;
  loansOutstanding: number | null;
  degraded: string[];
}> {
  const degraded: string[] = [];

  /*
   * The two OPEN selects ask for an exact count alongside the rows.
   * `listings.data.length` would give the same number today and be silently
   * wrong the day a PostgREST `max-rows` cap truncates the response — and a
   * truncated response also understates the value total, which is the harder
   * half to notice. With an exact count the two disagree visibly instead:
   * `coverage.rows` would fall below `openOffers + openRequests`.
   */
  const [listings, requests, serviced] = await Promise.all([
    supabase
      .from("kaleido_listings")
      .select("tokenAddress, amount", { count: "exact" })
      .eq("status", "OPEN"),
    supabase
      .from("kaleido_requests")
      .select("tokenAddress, amount", { count: "exact" })
      .eq("status", "OPEN"),
    supabase
      .from("kaleido_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "SERVICED"),
  ]);

  const loansOutstanding = serviced.error ? null : (serviced.count ?? null);
  if (serviced.error) {
    console.error(
      "[market/overview] serviced count failed:",
      serviced.error.message,
    );
    degraded.push("loansOutstanding");
  }

  const bookError = listings.error ?? requests.error;
  if (bookError) {
    console.error("[market/overview] book read failed:", bookError.message);
    return {
      usd: null,
      coverage: EMPTY_COVERAGE,
      openOffers: null,
      openRequests: null,
      loansOutstanding,
      degraded: [...degraded, "lendingTvlUsd", "openOffers", "openRequests"],
    };
  }

  /* PostgREST returns the count in a Content-Range header, so a proxy that
     strips it leaves `count` null with no error to go with it. A null tile with
     nothing in `degraded` reads as "still loading" rather than "not measured",
     hence naming the leg here too. */
  const openOffers = listings.count ?? null;
  const openRequests = requests.count ?? null;
  if (openOffers === null) degraded.push("openOffers");
  if (openRequests === null) degraded.push("openRequests");

  const rows = [
    ...((listings.data ?? []) as BookRow[]),
    ...((requests.data ?? []) as BookRow[]),
  ];
  const folded = foldBook(rows, CURRENCIES);

  if (folded.unknownToken > 0) {
    console.warn(
      `[market/overview] ${folded.unknownToken} row(s) reference a token absent ` +
        `from the read chain's lending currencies; excluded from the total rather than assumed 18dp`,
    );
  }

  /* getPrices throws when Hermes itself is unreachable — documented at
   * prices.ts:135-142, and correct: valuing a whole book at zero is worse than
   * saying the number is unavailable. So the throw becomes a degraded leg, and
   * every priceable row is reported unpriced rather than dropped. */
  let priceOf: (symbol: string) => number | null;
  try {
    const prices = await getPrices(folded.totals.map((t) => t.symbol));
    priceOf = (symbol) => prices.get(symbol)?.usd ?? null;
  } catch (err) {
    console.error("[market/overview] price feed unreachable:", err);
    priceOf = () => null;
    degraded.push("lendingTvlUsd");
  }

  const { usd, coverage } = valueBook(folded, priceOf);

  /* valueBook nulls the total when rows existed and none priced. That is its own
   * degraded condition, distinct from the throw above — a feed that answers but
   * has no entry for any token in the book lands here. */
  if (usd === null && !degraded.includes("lendingTvlUsd")) {
    degraded.push("lendingTvlUsd");
  }

  return {
    usd,
    coverage,
    openOffers,
    openRequests,
    loansOutstanding,
    degraded,
  };
}

/** kfUSD total supply, whole units. */
async function kfUsdSupplyLeg(): Promise<number | null> {
  try {
    /* string | undefined now: a chain without kfUSD deployed reports the supply
       as unmeasured (→ degraded) rather than constructing a contract at
       `undefined`. The read chain has it, so this is a guard, not a gap. */
    const kfUsdAddress = getContracts(READ_ONLY_CHAIN_ID).kfUSD;
    if (!kfUsdAddress) return null;
    const kfUSD = getERC20Contract(readOnlyProvider, kfUsdAddress);
    const supply = await withTimeout<bigint>(
      kfUSD.totalSupply(),
      "kfUSD.totalSupply",
    );
    return parseFloat(toWholeUnits(supply, 18));
  } catch (err) {
    console.error("[market/overview] kfUSD supply read failed:", err);
    return null;
  }
}

/**
 * Pooled KLD in the staking vault, in KLD.
 *
 * Not converted to dollars, and that is not an omission: `prices.ts:59-64` marks
 * KLD and stKLD UNPRICED because there is no market price before TGE. A dollar
 * figure here would have to invent one.
 *
 * `getTotalPooledKld` takes the token address — it is per-token, not a global
 * total, matching the call in useGetValueAndHealth.ts:180-181.
 */
async function kldStakedLeg(): Promise<number | null> {
  try {
    const staking = stakingContracts(READ_ONLY_CHAIN_ID);
    if (!staking.supported) return null;
    const vault = getKLDVaultContract(readOnlyProvider, READ_ONLY_CHAIN_ID);
    const pooled = await withTimeout<bigint>(
      vault.getTotalPooledKld(staking.kld),
      "vault.getTotalPooledKld",
    );
    return parseFloat(toWholeUnits(pooled, 18));
  } catch (err) {
    console.error("[market/overview] pooled KLD read failed:", err);
    return null;
  }
}

async function computeOverview(): Promise<MarketOverview> {
  const [lending, kfUsdSupply, kldStaked] = await Promise.all([
    lendingLeg(),
    kfUsdSupplyLeg(),
    kldStakedLeg(),
  ]);

  const degraded = [...lending.degraded];
  if (kfUsdSupply === null) degraded.push("kfUsdSupply");
  if (kldStaked === null) degraded.push("kldStaked");

  return {
    lendingTvlUsd: lending.usd,
    openOffers: lending.openOffers,
    openRequests: lending.openRequests,
    loansOutstanding: lending.loansOutstanding,
    kfUsdSupply,
    kldStaked,
    coverage: lending.coverage,
    asOf: new Date().toISOString(),
    degraded,
  };
}

/* ------------------------------------------------------------- caching -- */

/**
 * Process-local cache, the same shape as api/prices/route.ts:48-62 minus the
 * MAX_KEYS eviction: this route takes no parameters, so there is one entry
 * rather than a keyed map that could grow. `inflight` still matters — four
 * visitors landing on /leaderboard at once would otherwise each run two RPC
 * calls, three queries and a Hermes fetch.
 */
const TTL_MS = 60_000;
let cache: { at: number; data: MarketOverview } | null = null;
let inflight: Promise<MarketOverview> | null = null;

async function remember(): Promise<{ data: MarketOverview; stale: boolean }> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return { data: cache.data, stale: false };
  }

  if (!inflight) {
    inflight = computeOverview()
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }

  try {
    return { data: await inflight, stale: false };
  } catch (err) {
    /* Serve the last good figures rather than nothing, but flag them stale so
     * the caller can label them. With nothing cached, this is a 500 — an empty
     * strip is honest, a zeroed one is not. */
    if (cache) {
      console.error("[market/overview] recompute failed, serving stale:", err);
      return { data: cache.data, stale: true };
    }
    throw err;
  }
}

export async function GET() {
  try {
    const { data, stale } = await remember();
    return NextResponse.json(
      { success: true, data, stale },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[market/overview] failed:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to compute market overview",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
