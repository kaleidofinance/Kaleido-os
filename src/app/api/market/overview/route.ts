/**
 * Protocol-wide headline figures for the stat strips on /leaderboard and the
 * Borrow/Lend shell.
 *
 * This exists because the strip cannot be computed in the browser, for two
 * reasons that are both hard constraints rather than preferences:
 *
 *  1. Book amounts are **base-unit integers** — `uint256` on chain, and they
 *     were TEXT in the mirror this used to read for the same reason the
 *     migration gives (20260731000000_kaleido_core_tables.sql:19-25):
 *     "18-decimal amounts run past 10^19 and overflow float64". The hook this
 *     route replaces did `Number(item.amount)` and summed across tokens, so a
 *     1 USDC offer (1e6) and a 1 ETH offer (1e18) added to 1000000000001000000
 *     and rendered as $1,000,000,000,001,000,000.
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

import {
  borrowCurrencies,
  getContracts,
  registeredLendingAssets,
  stakingContracts,
} from "@/constants/registry";
import { readOnlyProvider, READ_ONLY_CHAIN_ID } from "@/config/provider";
import { readBookRows } from "@/lib/lending/book";
import { getERC20Contract, getKLDVaultContract } from "@/config/contracts";
import { getPrices } from "@/lib/points/prices";
import {
  EMPTY_COVERAGE,
  foldBook,
  toWholeUnits,
  valueBook,
  type BookRow,
  type Currency,
  type MarketCoverage,
  type MarketOverview,
} from "@/lib/market/bookValue";

export const dynamic = "force-dynamic";

/**
 * Decimals resolve through the read chain's lending-currency list rather than a
 * per-row `decimalsForAddress(chainId, address)`, and that is forced, not lazy:
 *
 *  - `readBookRows` is called with `READ_ONLY_CHAIN_ID`, so every row returned
 *    is from that chain by construction and `borrowCurrencies(READ_ONLY_CHAIN_ID)`
 *    resolves it. There is no row here whose chain is in doubt — which was NOT
 *    true of the mirror these rows used to come from, whose tables carry no
 *    chainId column at all.
 *
 * When this strip covers a second chain the shape changes: read each chain's
 * book and resolve decimals per chain, rather than widening the guess here.
 */
/*
 * REGISTERED assets first, then the offered list — merged, deduped by address.
 *
 * `borrowCurrencies` alone was wrong here, and measurably: on 2026-09-09 it
 * named ETH, USDC, USDT and kfUSD on Sepolia, while the diamond's own book held
 * 14 open rows denominated in WETH. Every one of those was dropped from the
 * total as an unknown token — a real offer, excluded from TVL, because the list
 * being consulted describes what this app OFFERS rather than what the facet
 * ACCEPTS. That gap is documented in useLendingAssets.ts and it runs both ways:
 * kfUSD and USDT are offered here and registered on no chain.
 *
 * `registeredLendingAssets(chain, "collateral")` is the union of both registered
 * arrays (a loanable token is depositable too — see its header), so it names
 * every address the facet has ever accepted for lending on this chain. The
 * offered list is appended rather than dropped so a token de-registered while it
 * still has open rows keeps resolving: the row is on the book either way, and
 * excluding it would understate the total for a reason the reader cannot see.
 *
 * Two entries can share a symbol — Sepolia has both the Circle and the mock USDC
 * registered — and that is correct: `foldBook` folds by symbol, and both are USDC
 * at 6 decimals, so they sum into one total the way a reader would expect.
 */
const CURRENCIES: Currency[] = (() => {
  const merged = [
    ...registeredLendingAssets(READ_ONLY_CHAIN_ID, "collateral").assets,
    ...borrowCurrencies(READ_ONLY_CHAIN_ID),
  ];
  const seen = new Set<string>();
  return merged.filter((c) => {
    const key = c.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
})();

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
   * The book comes from the diamond, not from `kaleido_listings` /
   * `kaleido_requests`.
   *
   * These three legs were Supabase selects until 2026-09-09, and every tile they
   * fed had been reading zero since launch: the mirror tables have never had a
   * row, because the indexer that fills them (server/src/syncListing.ts) has
   * never been run. Sepolia's diamond held 39 open listings and 16 open requests
   * on the day this was measured, so "lending TVL $0 / 0 offers / 0 loans" was a
   * headline figure about a market that existed. A stalled indexer's empty
   * result is indistinguishable from an empty market — the argument
   * lib/lending/book.ts makes at length — and here the app was publishing that
   * ambiguity as a number.
   *
   * `readBookRows` is one Multicall3 round trip per side and returns null rather
   * than an empty array when the chain does not answer, which is what keeps the
   * "not measured" tile distinct from a real zero.
   */
  const [listingRows, requestRows] = await Promise.all([
    readBookRows(READ_ONLY_CHAIN_ID, "listings").catch(() => null),
    readBookRows(READ_ONLY_CHAIN_ID, "requests").catch(() => null),
  ]);

  /*
   * SERVICED requests are the funded loans. Counted off the same read as the
   * open ones rather than by a second query — one read of the book answers both,
   * and two reads could disagree about a request funded between them.
   */
  const loansOutstanding =
    requestRows === null
      ? null
      : requestRows.filter((r) => r.status === "SERVICED").length;
  if (loansOutstanding === null) {
    console.error("[market/overview] serviced count failed: book unreadable");
    degraded.push("loansOutstanding");
  }

  if (listingRows === null || requestRows === null) {
    console.error("[market/overview] book read failed: chain did not answer");
    return {
      usd: null,
      coverage: EMPTY_COVERAGE,
      openOffers: null,
      openRequests: null,
      loansOutstanding,
      degraded: [...degraded, "lendingTvlUsd", "openOffers", "openRequests"],
    };
  }

  const openListings = listingRows.filter((l) => l.status === "OPEN");
  const openReqs = requestRows.filter((r) => r.status === "OPEN");

  /* Counted from the rows the value total is computed over, so the two cannot
     disagree — the failure mode the exact-count select above was guarding
     against (a truncated response understating the total while the count stayed
     right) cannot arise when one array feeds both. */
  const openOffers = openListings.length;
  const openRequests = openReqs.length;

  const rows: BookRow[] = [...openListings, ...openReqs].map((r) => ({
    tokenAddress: r.tokenAddress,
    amount: r.amount,
  }));
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
