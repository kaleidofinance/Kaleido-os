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
import { CHAINS_BY_ID } from "@/constants/chains";
import { readBookRows } from "@/lib/lending/book";
import { lendingChains } from "@/lib/lending/chain";
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
 * The book now covers every deployed lending chain, so decimals are resolved
 * per chain rather than widening one chain's registry into a global guess.
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
function currenciesForChain(chainId: number): Currency[] {
  const merged = [
    ...registeredLendingAssets(chainId, "collateral").assets,
    ...borrowCurrencies(chainId),
  ];
  const seen = new Set<string>();
  return merged.filter((c) => {
    const key = c.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
async function lendingLeg(testnets: boolean): Promise<{
  usd: number | null;
  coverage: MarketCoverage;
  openOffers: number | null;
  openRequests: number | null;
  loansOutstanding: number | null;
  degraded: string[];
}> {
  const degraded: string[] = [];
  const chains = lendingChains().filter(
    (chainId) => testnets || CHAINS_BY_ID[chainId]?.network === "mainnet",
  );
  if (chains.length === 0) {
    return {
      usd: null,
      coverage: EMPTY_COVERAGE,
      openOffers: null,
      openRequests: null,
      loansOutstanding: null,
      degraded: ["lendingBook"],
    };
  }

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
  const books = await Promise.all(
    chains.map(async (chainId) => {
      const [listingRows, requestRows] = await Promise.all([
        readBookRows(chainId, "listings").catch(() => null),
        readBookRows(chainId, "requests").catch(() => null),
      ]);
      return { chainId, listingRows, requestRows };
    }),
  );

  const readable = books.filter(
    (book): book is typeof book & {
      listingRows: NonNullable<typeof book.listingRows>;
      requestRows: NonNullable<typeof book.requestRows>;
    } => book.listingRows !== null && book.requestRows !== null,
  );
  for (const book of books) {
    if (book.listingRows === null || book.requestRows === null) {
      console.error(
        `[market/overview] lending book read failed on chain ${book.chainId}`,
      );
      degraded.push(`lendingBook:${book.chainId}`);
    }
  }
  if (readable.length === 0) {
    return {
      usd: null,
      coverage: EMPTY_COVERAGE,
      openOffers: null,
      openRequests: null,
      loansOutstanding: null,
      degraded: [
        ...degraded,
        "lendingTvlUsd",
        "openOffers",
        "openRequests",
        "loansOutstanding",
      ],
    };
  }

  const openListings = readable.flatMap((book) =>
    book.listingRows.filter((l) => l.status === "OPEN"),
  );
  const openReqs = readable.flatMap((book) =>
    book.requestRows.filter((r) => r.status === "OPEN"),
  );
  const loansOutstanding = readable.reduce(
    (count, book) =>
      count + book.requestRows.filter((r) => r.status === "SERVICED").length,
    0,
  );

  /* Counted from the rows the value total is computed over, so the two cannot
     disagree — the failure mode the exact-count select above was guarding
     against (a truncated response understating the total while the count stayed
     right) cannot arise when one array feeds both. */
  const openOffers = openListings.length;
  const openRequests = openReqs.length;

  const foldedByChain = readable.map((book) => {
    const rows: BookRow[] = [
      ...book.listingRows.filter((l) => l.status === "OPEN"),
      ...book.requestRows.filter((r) => r.status === "OPEN"),
    ].map((r) => ({ tokenAddress: r.tokenAddress, amount: r.amount }));
    return {
      chainId: book.chainId,
      folded: foldBook(rows, currenciesForChain(book.chainId)),
    };
  });
  const foldedRows = foldedByChain.flatMap(({ folded }) => folded.totals);
  const symbols = [...new Set(foldedRows.map((row) => row.symbol))];

  /* getPrices throws when Hermes itself is unreachable — documented at
   * prices.ts:135-142, and correct: valuing a whole book at zero is worse than
   * saying the number is unavailable. So the throw becomes a degraded leg, and
   * every priceable row is reported unpriced rather than dropped. */
  let priceOf: (symbol: string) => number | null;
  try {
    const prices = await getPrices(symbols);
    priceOf = (symbol) => prices.get(symbol)?.usd ?? null;
  } catch (err) {
    console.error("[market/overview] price feed unreachable:", err);
    priceOf = () => null;
    degraded.push("lendingTvlUsd");
  }

  const valued = foldedByChain.map(({ folded }) => valueBook(folded, priceOf));
  const pricedParts = valued.filter((part) => part.usd !== null);
  const hasRows = valued.some((part) => part.coverage.rows > 0);
  const usd =
    pricedParts.length > 0
      ? pricedParts.reduce((sum, part) => sum + (part.usd ?? 0), 0)
      : hasRows
        ? null
        : 0;
  const coverage = valued.reduce(
    (total, part) => ({
      rows: total.rows + part.coverage.rows,
      valued: total.valued + part.coverage.valued,
      unpriced: total.unpriced + part.coverage.unpriced,
      unknownToken: total.unknownToken + part.coverage.unknownToken,
      malformedAmount: total.malformedAmount + part.coverage.malformedAmount,
    }),
    EMPTY_COVERAGE,
  );
  if (coverage.unknownToken > 0) {
    console.warn(
      `[market/overview] ${coverage.unknownToken} row(s) reference a token absent ` +
        `from their chain's lending currencies; excluded from the total rather than assumed 18dp`,
    );
  }

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

/**
 * The lending book lives on the read chain, which is a testnet at launch — no
 * mainnet chain has a lending diamond yet (Arc is DEX-first). So a mainnet-first
 * viewer must NOT be shown that testnet book's offers, requests and loans on the
 * Borrow/Lend strip: it reads as a live mainnet market that does not exist. When
 * testnets are hidden and the read chain is itself a testnet, the lending leg is
 * the honest empty market — 0 offers, 0 requests, 0 loans, $0 book — until a
 * mainnet lending deployment lands, at which point the read chain being mainnet
 * the lending chain filter includes it on its own. kfUSD supply and pooled KLD are protocol
 * tiles on /leaderboard, not the Borrow strip, and are left as-is.
 */
async function computeOverview(testnets: boolean): Promise<MarketOverview> {
  const [lending, kfUsdSupply, kldStaked] = await Promise.all([
    lendingLeg(testnets),
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
/* Keyed by the testnet flag — the mainnet and testnet views compute different
   lending legs, so they cannot share one cache entry. Two keys, no eviction. */
const cache = new Map<string, { at: number; data: MarketOverview }>();
const inflight = new Map<string, Promise<MarketOverview>>();

async function remember(
  testnets: boolean,
): Promise<{ data: MarketOverview; stale: boolean }> {
  const key = testnets ? "testnet" : "mainnet";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return { data: hit.data, stale: false };
  }

  if (!inflight.has(key)) {
    inflight.set(
      key,
      computeOverview(testnets)
        .then((data) => {
          cache.set(key, { at: Date.now(), data });
          return data;
        })
        .finally(() => {
          inflight.delete(key);
        }),
    );
  }

  try {
    return { data: await inflight.get(key)!, stale: false };
  } catch (err) {
    /* Serve the last good figures rather than nothing, but flag them stale so
     * the caller can label them. With nothing cached, this is a 500 — an empty
     * strip is honest, a zeroed one is not. */
    const stale = cache.get(key);
    if (stale) {
      console.error("[market/overview] recompute failed, serving stale:", err);
      return { data: stale.data, stale: true };
    }
    throw err;
  }
}

export async function GET(request: Request) {
  try {
    /* `?testnets=1` when the viewer has the testnet toggle on. Default (mainnet)
       hides the testnet lending book. */
    const testnets =
      new URL(request.url).searchParams.get("testnets") === "1";
    const { data, stale } = await remember(testnets);
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
