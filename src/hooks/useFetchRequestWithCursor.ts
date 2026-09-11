"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveAccount } from "thirdweb/react";
import { Request, LoanListing } from "@/constants/types";
import {
  readBookRows,
  type BookListingRow,
  type BookRequestRow,
} from "@/lib/lending/book";
import { lendingChains } from "@/lib/lending/chain";
import { MOCK_DATA, mockListings, mockRequests } from "@/lib/mock";

/**
 * The browsable P2P book, read from the diamond that holds it.
 *
 * These two hooks used to `fetch("/api/listings")` and `fetch("/api/requests")`,
 * which query the Supabase mirror. On 2026-09-09 a tester reported posting
 * offers "many times" and never finding them, and the measurement was
 * unambiguous: Sepolia's diamond held 39 OPEN listings and 16 OPEN requests
 * while both endpoints answered `total: 0`. The tables have never had a row —
 * `server/src/syncListing.ts` fills them and has never been run — so every
 * borrower has seen an empty market and every lender's offer has disappeared the
 * moment it was posted. Nothing in the app was broken; it was reading a mirror
 * of nothing.
 *
 * So the book comes from the chain now, in one Multicall3 round trip — see
 * `readBookRows` in src/lib/lending/book.ts, and the note at the top of that file
 * for why the "indexes are good at paging, 200 eth_calls are not" trade that
 * justified the mirror stopped being true when the multicall layer landed.
 *
 * **The public shape is unchanged on purpose.** Everything downstream —
 * useEnhancedCardData's filters, useDataFiltersPanel, BorrowBookView's tabs —
 * already filters, sorts and pages client-side over whatever array these return,
 * so the swap is a source change and not a rewrite of the surface above it.
 *
 * What genuinely changes is pagination: the whole book arrives at once, so
 * `hasMore` is false and `loadMore` re-reads rather than appending. There is no
 * cursor to carry — a multicall has no pages — and a "Load more" that can never
 * add a row is better than one that pages through a table with nothing in it.
 *
 * Chains: EVERY deployed lending chain, swept together — see `useBook` below and
 * `lendingChains`. The book shows offers and requests from all five testnets at
 * once, each row tagged with its own chain, the way the Pool page shows every
 * chain's pools. A take or a cancel targets the row's chain, not the connected
 * one; posting a new offer uses the connected chain. This replaced the single
 * chain the book used to be pinned to.
 */

/** The filters the callers pass. Applied to the fetched rows, not to a query. */
interface FetchParams {
  /** CSV, as the endpoint took it: "OPEN" or "OPEN,SERVICED". */
  status?: string;
  tokenAddress?: string;
  /** Request owner. */
  author?: string;
  lender?: string;
  /** Listing owner. */
  sender?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  /** Exact id lookup, still called `searchId` because the search box writes it. */
  searchId?: string;
}

interface CursorHookParams extends FetchParams {
  searchId?: string;
}

/** 15s, matching the read layer's staleTime — a book turns over slowly. */
const REFETCH_MS = 15_000;

const sameAddress = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * The status CSV, matched case-insensitively.
 *
 * Empty or absent means "every status", which is what the endpoint did with no
 * `status` param — and what /myloans relies on, since a row the user should see
 * on their own tab can be CLOSED.
 */
function statusMatches(rowStatus: string | undefined, csv?: string): boolean {
  if (!csv) return true;
  const wanted = csv
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (wanted.length === 0) return true;
  return wanted.includes(String(rowStatus ?? "").toUpperCase());
}

/**
 * An id search that is not a positive integer matches nothing.
 *
 * The same rule `parseBookIdSearch` applied server-side: these ids are contract
 * counters, so "abc" and "-1" name no row rather than every row.
 */
function idMatches(rowId: number | undefined, searchId?: string): boolean {
  if (!searchId || !searchId.trim()) return true;
  const n = Number(searchId.trim());
  if (!Number.isInteger(n) || n <= 0) return false;
  return Number(rowId) === n;
}

/** Either side's row, as `readBookRows` returns it, tagged with its chain. */
type BookRow = (BookListingRow | BookRequestRow) & { chainId: number };

interface BookResult {
  rows: BookRow[];
  /** Chains that were asked and did not answer. A partial book, not an empty one. */
  failed: number[];
}

/**
 * The whole book, swept across every lending chain, each row tagged with the
 * chain it came from.
 *
 * This is what makes lending multi-chain: instead of one chain pinned by
 * LENDING_CHAIN_ID, every deployed chain's diamond is read in parallel and the
 * rows are merged, each carrying its `chainId` so the table can tag it and a
 * take/cancel can target the right chain.
 *
 * A PER-CHAIN FAILURE IS NOT AN EMPTY BOOK. readBookRows returns null when a
 * chain declines to answer. On one chain that used to mean "show the error state
 * rather than lie that the market is empty" — and that reasoning still holds, but
 * across five chains it must not blank the four that DID answer. So a failed
 * chain drops out of the rows and into `failed`, and only an all-chains failure
 * reads as the book being unreadable.
 */
function useBook<T>(
  side: "listings" | "requests",
  enabled: boolean,
): { rows: T[]; loading: boolean; error: string | null; refetch: () => void } {
  const chains = useMemo(() => lendingChains(), []);

  const query = useQuery<BookResult>({
    queryKey: ["lendingBook", "all", side],
    queryFn: async () => {
      const perChain = await Promise.all(
        chains.map(async (chainId) => {
          try {
            const rows =
              side === "listings"
                ? await readBookRows(chainId, "listings")
                : await readBookRows(chainId, "requests");
            if (rows === null) return { chainId, rows: null };
            return {
              chainId,
              rows: rows.map((r) => ({ ...r, chainId })) as BookRow[],
            };
          } catch {
            return { chainId, rows: null };
          }
        }),
      );

      const rows: BookRow[] = [];
      const failed: number[] = [];
      for (const r of perChain) {
        if (r.rows === null) failed.push(r.chainId);
        else rows.push(...r.rows);
      }
      return { rows, failed };
    },
    enabled,
    refetchInterval: REFETCH_MS,
  });

  const data = query.data;
  /* Unreadable only when EVERY chain failed — one chain down leaves the rest. */
  const allFailed =
    !!data && data.rows.length === 0 && data.failed.length === chains.length;

  return {
    rows: (data?.rows ?? []) as T[],
    loading: query.isLoading,
    error:
      query.isError || allFailed
        ? "Couldn't read the order book from the chain."
        : null,
    refetch: query.refetch,
  };
}

export const useFetchRequestsWithCursor = (params?: CursorHookParams) => {
  const activeAccount = useActiveAccount();
  const address = activeAccount?.address;

  const book = useBook<Request>("requests", !MOCK_DATA && !!params);

  const rows = useMemo(() => {
    if (!params) return [];
    /* Demo mode. `mockRequests` applies the endpoint's own selection rules to the
       fixture book, so /borrow and /myloans still differ here exactly as they do
       against a live chain. Delete with src/lib/mock. */
    if (MOCK_DATA) return mockRequests(address, params);

    return book.rows.filter(
      (r) =>
        statusMatches(r.status, params.status) &&
        idMatches(r.requestId, params.searchId) &&
        (!params.author || sameAddress(r.author, params.author)) &&
        (!params.lender || sameAddress(r.lender, params.lender)) &&
        (!params.tokenAddress ||
          sameAddress(r.tokenAddress, params.tokenAddress)),
    );
  }, [book.rows, params, address]);

  /* Takes the page size its callers still pass and ignores it: a multicall has no
     cursor, so there is no next page to size. Kept in the signature rather than
     dropped so useEnhancedCardData's `loadMore(amount)` keeps typechecking. */
  const refresh = useCallback(
    (_amount?: number) => {
      book.refetch();
    },
    [book.refetch],
  );

  const myRequests = useMemo(
    () => (address ? rows.filter((r) => sameAddress(r.author, address)) : []),
    [rows, address],
  );

  const activeRequests = useMemo(
    () => rows.filter((r) => r.status === "OPEN" || r.status === "SERVICED"),
    [rows],
  );

  return {
    requests: rows,
    activeRequests,
    myRequests,
    loading: MOCK_DATA ? false : book.loading,
    isLoadingMore: false,
    error: MOCK_DATA ? null : book.error,
    /* The whole book is here, so there is nothing further to load. */
    hasMore: false,
    total: rows.length,
    count: rows.length,
    isSearching: !!params?.searchId,
    searchId: params?.searchId,
    loadMore: refresh,
    refresh,
    refreshRequests: refresh,
  };
};

export const useFetchListingsWithCursor = (params?: CursorHookParams) => {
  const activeAccount = useActiveAccount();
  const address = activeAccount?.address;

  const book = useBook<LoanListing>("listings", !MOCK_DATA && !!params);

  const rows = useMemo(() => {
    if (!params) return [];
    /* Demo mode, as above — `mockListings` applies the listings endpoint's own
       rules, which are not the requests endpoint's. Delete with src/lib/mock. */
    if (MOCK_DATA) return mockListings(address, params);

    return book.rows.filter(
      (l) =>
        statusMatches(l.status, params.status) &&
        idMatches(l.listingId, params.searchId) &&
        (!params.sender || sameAddress(l.sender, params.sender)) &&
        (!params.tokenAddress ||
          sameAddress(l.tokenAddress, params.tokenAddress)),
    );
  }, [book.rows, params, address]);

  /* Takes the page size its callers still pass and ignores it: a multicall has no
     cursor, so there is no next page to size. Kept in the signature rather than
     dropped so useEnhancedCardData's `loadMore(amount)` keeps typechecking. */
  const refresh = useCallback(
    (_amount?: number) => {
      book.refetch();
    },
    [book.refetch],
  );

  const myListings = useMemo(
    () => (address ? rows.filter((l) => sameAddress(l.sender, address)) : []),
    [rows, address],
  );

  const openListings = useMemo(
    () => rows.filter((l) => l.status === "OPEN"),
    [rows],
  );

  return {
    listings: rows,
    openListings,
    myListings,
    loading: MOCK_DATA ? false : book.loading,
    isLoadingMore: false,
    error: MOCK_DATA ? null : book.error,
    hasMore: false,
    total: rows.length,
    count: rows.length,
    isSearching: !!params?.searchId,
    searchId: params?.searchId,
    loadMore: refresh,
    refresh,
    refreshListings: refresh,
    myLendOrder: {
      loadings: MOCK_DATA ? false : book.loading,
      data: myListings,
    },
  };
};

// Backward compatibility exports
export const useFetchAllRequests = useFetchRequestsWithCursor;
export const useFetchAllListings = useFetchListingsWithCursor;
export default useFetchRequestsWithCursor;
