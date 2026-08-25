"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { toast } from "sonner";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { type ActiveLoan } from "@/hooks/v2/useBorrowV2";
import type { LendingFees } from "@/hooks/useLendingFees";
import { useLendingData } from "@/components/v2/LendingDataContext";
import { formatAddress } from "@/constants/utils/formatAddress";
import { convertbasisPointsToPercentage } from "@/constants/utils/FormatInterestRate";
import { getTimeUntil, getOverdue } from "@/constants/utils/formatOderDate";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";
import { READ_ONLY_CHAIN_ID } from "@/config/provider";
import { describeLendingAsset, type LendingAsset } from "@/lib/lending/assets";
import { LENDING_CHAIN_ID } from "@/lib/lending/chain";
import {
  formatBps,
  netLenderRateBps,
  penaltySplitBps,
} from "@/lib/lending/fees";
import { formatWithCommas } from "@/constants/utils/formatNumber";
import { declaredSymbol, isNativeSentinel } from "@/constants/registry";
import TokenIcon from "@/components/v2/TokenIcon";
import { TakeLoanModal } from "@/components/v2/BorrowModals";
import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import s from "@/app/(app)/(lending)/borrow.module.css";

export type BorrowBookMode = "borrow" | "lend" | "mine" | "mylends";

type SortKey = "interest" | "returnDate" | "amount";
type SortDir = "asc" | "desc";

/*
 * The loaded shape of a row, which is what PostgREST returns — not
 * constants/types' LoanListing/Request, which disagree with the schema (they
 * call the id fields numbers but minAmount/maxAmount snake_case, and the reads
 * below cast past them).
 *
 * `listingId`, `requestId` and `returnDate` are all `bigint` columns in
 * supabase/migrations/20260731000000_kaleido_core_tables.sql, so they arrive as
 * JSON numbers. They were declared string here, which is harmless while every
 * use site coerces but not while an id is compared for equality.
 */
interface Row {
  listingId?: number;
  requestId?: number;
  tokenAddress: string;
  amount: string;
  interest: number;
  status: string;
  returnDate: number;
  sender?: string;
  author?: string;
  lender?: string;
  totalRepayment?: string;
}

function untilShort(ts: number, nowSec: number): string {
  const diff = ts - nowSec;
  if (diff <= 0) return "Overdue";
  const days = Math.floor(diff / 86400);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(diff / 3600);
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.floor(diff / 60))}m`;
}

/**
 * The order book's ID search.
 *
 * `searchByIdAtom` has been read by useEnhancedCardData all along — it becomes the
 * `searchId` cursor param, which /api/listings and /api/requests resolve to an
 * exact match on the bigint listing/request id (parseBookIdSearch). Nothing ever
 * wrote it, so this field is the first writer; the setter now lives on the shared
 * filter panel beside filterByOwner.
 *
 * It debounces into the atom rather than writing on every keystroke — each write
 * re-runs the cursor fetch, and an id is typed a digit at a time. Local state
 * keeps the field responsive; `committed` lets an external reset (Clear, or
 * clearAllFilters) win without clobbering a keystroke mid-debounce.
 */
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [text, setText] = useState(value);
  const committed = useRef(value);

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    const next = text.trim();
    if (next === committed.current) return;
    const t = setTimeout(() => {
      committed.current = next;
      onChange(next);
    }, 300);
    return () => clearTimeout(t);
  }, [text, onChange]);

  return (
    <div className={s.search}>
      <input
        className={s.searchInput}
        type="text"
        inputMode="numeric"
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
      />
      {text && (
        <button
          type="button"
          className={s.searchClear}
          aria-label="Clear search"
          onClick={() => {
            setText("");
            committed.current = "";
            onChange("");
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Which way a column reads best, given which side of the book the viewer is on.
 *
 * A borrower wants the cheapest money at the top; a lender wants the highest
 * yield. Every other column is smallest-first for both. This used to live only
 * inside the click handler while the initial state was a flat `"asc"`, so /lend
 * *opened* on the least attractive requests in the book — under a Market card
 * that named the highest APR as the best rate — and only sorted itself out once
 * the user clicked APR twice.
 */
const defaultDir = (key: SortKey, borrower: boolean): SortDir =>
  key === "interest" && !borrower ? "desc" : "asc";

/**
 * What the protocol takes, and from whom.
 *
 * Both figures come off the diamond (`getBPS()`, `getLiquidityBPS()`) and neither
 * appeared anywhere in the app before this card. The wording is role-dependent
 * because the *incidence* is: the interest fee falls on the lender and the
 * liquidation penalty on the borrower, so a single neutral phrasing would be
 * misleading on one tab whichever way it was written.
 *
 * Three states, and the failure one still renders. Hiding the card when the read
 * fails would restore exactly the defect it exists to fix — the fees are charged
 * either way, so an unreadable rate is disclosed as unread rather than as absent.
 */
function FeeCard({ fees, lender }: { fees: LendingFees; lender: boolean }) {
  if (fees.loading) return null;

  const { interestFeeBps, liquidationPenaltyBps } = fees;
  const split =
    liquidationPenaltyBps === null
      ? null
      : penaltySplitBps(liquidationPenaltyBps);

  return (
    <div className={s.card}>
      <div className={s.cardTitle}>Protocol fees</div>
      <div className={s.posRow}>
        <span className={s.cardBody}>On interest</span>
        <span className="tabular">{formatBps(interestFeeBps)}</span>
      </div>
      <div className={s.posRow}>
        <span className={s.cardBody}>Liquidation penalty</span>
        <span className="tabular">{formatBps(liquidationPenaltyBps)}</span>
      </div>
      <p className={s.cardNote}>
        {interestFeeBps === null && liquidationPenaltyBps === null
          ? "These rates couldn't be read from the protocol just now. Both are still charged — the interest fee out of the lender's interest, the penalty out of a liquidated borrower's collateral."
          : lender
            ? "The interest fee is deducted from the interest paid to you at repayment; your principal is untouched. In a liquidation you are paid before anyone else — the penalty only comes out of collateral above your claim, so a shortfall costs the liquidator and the protocol, not you."
            : "The interest fee is deducted from your lender's interest, not added to your repayment. The liquidation penalty is charged on the debt and taken from your collateral if your health factor breaks."}
        {split &&
          ` Of the penalty, ${formatBps(split.liquidator)} goes to whoever closes the position and ${formatBps(split.protocol)} to the protocol.`}
      </p>
    </div>
  );
}

export default function BorrowBookView({ mode }: { mode: BorrowBookMode }) {
  const { filters, borrow } = useLendingData();
  const { isConnected } = useWalletV2();
  /* Serves four routes off one component, so gating here covers /borrow, /lend,
     /myloans and /mylends at once. Every one of them reads the Diamond. */
  const gate = useChainGate();
  // Derived from the prop, so it can seed the sort state below.
  const isBorrow = mode === "borrow";
  const isMine = mode === "mine";
  const isMyLends = mode === "mylends";
  const [sortKey, setSortKey] = useState<SortKey>("interest");
  const [sortDir, setSortDir] = useState<SortDir>(() =>
    defaultDir("interest", isBorrow),
  );
  const [takeTarget, setTakeTarget] = useState<{
    listingId: number;
    min: number;
    max: number;
    asset: LendingAsset;
  } | null>(null);
  const [repaying, setRepaying] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  /*
   * `isBorrow` alone can't drive this view, because the tabs vary on two
   * independent axes:
   *
   *   shape — /borrow and /mylends both render listings, which carry `sender`
   *           and `listingId`; /lend renders requests, which carry `author` and
   *           `requestId`. /mylends is `filters.myListings`, the listings whose
   *           sender is the connected address.
   *   role  — the user is the lender on /lend and /mylends, the borrower on
   *           /borrow and /myloans. That axis decides which way rates read
   *           (high APR is good for a lender), and `isBorrow` handles it
   *           correctly already — see rateClass, sortBy and market below.
   *
   * Treating /mylends as the request book left it reading `row.author` off a
   * listing, so no row matched the user, Close was unreachable, and the enabled
   * Fund button called serviceRequest(NaN).
   */
  const isListingShape = isBorrow || isMyLends;

  /*
   * Which side of the interest fee the viewer is on.
   *
   * `getBPS()` is taken out of the interest at repayment and the remainder is
   * credited to the lender, so the borrower's obligation is exactly the row's APR
   * while the lender receives less than it. The book showed one number to both
   * roles — correct for /borrow and /myloans, overstated by a tenth on /lend and
   * /mylends. Same axis as rateClass and the Market card; see the note above.
   */
  const isLenderRole = !isBorrow && !isMine;

  useEffect(() => {
    // useEnhancedCardData.loadMore dispatches on this atom, so /mylends has to
    // claim the borrow table — its rows come out of the listings dataset.
    // Leaving it unset meant the atom kept whatever the previous tab wrote, and
    // "Load more" here fetched another page of loan requests instead.
    filters?.handleTableChange?.(mode === "lend" ? "lend" : "borrow");
  }, [mode, filters?.handleTableChange]);

  // Taking a loan shrinks the listing, opens a new loan, and locks collateral;
  // repaying closes a loan and frees collateral. Refresh whatever each touches
  // so every tab reflects it without a reload.
  const onTakeDone = () => {
    filters?.refreshListings?.();
    borrow.refreshLoans();
    borrow.refreshPosition();
  };

  const onRepay = async (loan: ActiveLoan) => {
    setRepaying(loan.requestId);
    try {
      await borrow.repay(loan);
      borrow.refreshLoans();
      borrow.refreshPosition();
    } finally {
      setRepaying(null);
    }
  };

  const openTake = (row: Row) => {
    /*
     * Resolve the listing's own asset before opening the modal, out of the set the
     * diamond reported. That is what carries the decimals used both to render the
     * band below and, downstream, to scale the borrow amount.
     *
     * It used to read `getTokenDecimals(READ_ONLY_CHAIN_ID, addr)` — which falls
     * back to 6 for anything it cannot place — and pass `tokenImageMap[addr]?.label
     * ?? "USDC"` as the symbol, which useAcceptListedAds then turned back into a
     * scale with `=== "ETH" ? 18 : 6`. So an 18-decimal listing token that was not
     * called ETH had its band displayed 1e12 too large and was borrowed 1e12 too
     * small, and an unmapped token was silently labelled USDC.
     *
     * describeLendingAsset is the fallback for a listing whose token has since been
     * de-registered: the row is still in the book and still repayable, so it should
     * not become unnameable the moment the operator removes the asset.
     */
    const addr = String(row.tokenAddress).toLowerCase();
    const asset =
      borrow.assets.loanable.find((a) => a.address.toLowerCase() === addr) ??
      borrow.assets.collateral.find((a) => a.address.toLowerCase() === addr) ??
      describeLendingAsset(LENDING_CHAIN_ID, row.tokenAddress);

    if (!asset) {
      toast.error(
        "This offer is denominated in a token we can't identify — refresh and try again.",
      );
      return;
    }

    const raw = row as Row & {
      minAmount?: string;
      maxAmount?: string;
      min_amount?: string;
      max_amount?: string;
    };
    const min = raw.minAmount ?? raw.min_amount ?? "0";
    const max = raw.maxAmount ?? raw.max_amount ?? row.amount;
    setTakeTarget({
      listingId: Number(row.listingId),
      min: Number(ethers.formatUnits(min, asset.decimals)),
      max: Number(ethers.formatUnits(max, asset.decimals)),
      asset,
    });
  };

  /*
   * closeListingAd, closeRequest and serviceRequest all await their own
   * tx.wait() but none of them refetch, so without an explicit refresh a closed
   * offer, a closed request and a funded request each stay on screen until a
   * reload. That is worst on /mylends, where closing an offer is the only thing
   * the tab is for. Failures are caught and toasted inside those hooks, so a
   * refresh after one just re-reads unchanged state.
   *
   * The id guard is what keeps the NaN out: rather than trusting the branch to
   * match the row shape, a row with no id for this shape does nothing at all.
   */
  const rowId = (row: Row) => (isListingShape ? row.listingId : row.requestId);

  const closeRow = async (row: Row) => {
    const id = rowId(row);
    if (id === undefined) return;
    setPending(id);
    try {
      if (isListingShape) await filters?.closeListingAd(Number(id));
      else await filters?.closeRequest(Number(id));
      filters?.refreshListings?.();
    } finally {
      setPending(null);
    }
  };

  const fundRow = async (row: Row) => {
    if (row.requestId === undefined) return;
    setPending(row.requestId);
    try {
      await filters?.serviceRequest(
        Number(row.requestId),
        String(row.tokenAddress),
        row.amount,
      );
      filters?.refreshListings?.();
    } finally {
      setPending(null);
    }
  };

  // Rebuilt on every render inside useDataFiltersPanel, so it is read straight
  // rather than memoised. It was previously missing from `book`'s dependency
  // list, which only avoided going stale because filteredBorrowData happens to
  // change alongside it — both derive from the same fetched listings.
  const myListings = (filters?.myListings ?? []) as unknown as Row[];

  const book: Row[] = useMemo(() => {
    if (isMine) return [];
    // The user's own offers, already filtered on sender by useDataFiltersPanel.
    if (isMyLends) return myListings;
    return ((isBorrow
      ? filters?.filteredBorrowData
      : filters?.filteredLendData) ?? []) as unknown as Row[];
  }, [
    isMine,
    isMyLends,
    isBorrow,
    myListings,
    filters?.filteredBorrowData,
    filters?.filteredLendData,
  ]);

  // /mylends filters the listings dataset, so it waits on the borrow-side flag;
  // the request book's loading state has nothing to do with it.
  const loading = isListingShape
    ? filters?.loadingBorrow
    : filters?.lendLoading;

  const sorted = useMemo(() => {
    const copy = [...book];
    copy.sort((a, b) => {
      const pick = (r: Row) =>
        sortKey === "interest"
          ? Number(r.interest)
          : sortKey === "returnDate"
            ? Number(r.returnDate)
            : Number(r.amount);
      return sortDir === "asc" ? pick(a) - pick(b) : pick(b) - pick(a);
    });
    return copy;
  }, [book, sortKey, sortDir]);

  const median = useMemo(() => {
    const rates = book
      .map((r) => Number(r.interest))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    return rates.length ? rates[Math.floor(rates.length / 2)] : 0;
  }, [book]);

  const market = useMemo(() => {
    const open = book.filter((r) => String(r.status).toUpperCase() === "OPEN");
    const bps = open
      .map((r) => Number(r.interest))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!bps.length) return null;
    const terms = open
      .map((r) => Number(r.returnDate))
      .filter((n) => Number.isFinite(n) && n > 0);
    return {
      bestBps: isBorrow ? Math.min(...bps) : Math.max(...bps),
      minTerm: terms.length ? Math.min(...terms) : null,
      maxTerm: terms.length ? Math.max(...terms) : null,
    };
  }, [book, isBorrow]);

  const PER_PAGE = 10;
  const pageCount = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const curPage = Math.min(page, pageCount);
  const pageRows = sorted.slice((curPage - 1) * PER_PAGE, curPage * PER_PAGE);

  // Same dataset as `loading`: another page of listings can bring more of the
  // user's own with it, so /mylends offers "Load more" off the borrow cursor.
  const hasMore =
    (isListingShape ? filters?.hasMoreBorrow : filters?.hasMoreLend) ?? false;
  const loadingMore =
    (isListingShape
      ? filters?.isLoadingMoreBorrow
      : filters?.isLoadingMoreLend) ?? false;

  const rateClass = (bps: number) => {
    if (!median || !bps) return "";
    const good = isBorrow ? bps < median * 0.85 : bps > median * 1.15;
    const bad = isBorrow ? bps > median * 1.15 : bps < median * 0.85;
    return good ? s.rateGood : bad ? s.rateBad : "";
  };

  const sortBy = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(defaultDir(key, isBorrow));
    }
  };

  const sortMark = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  useEffect(() => {
    setPage(1);
  }, [mode, sortKey, sortDir]);

  /*
   * All four tabs render the same element type in the same slot of the
   * (lending) layout, so React reconciles them and this component keeps its
   * state across the navigation — which is why `page` is reset above rather
   * than just initialised. The sort needs the same treatment: carrying
   * /borrow's lowest-APR-first order into /lend puts the worst requests on top
   * of the lender's book, and the flip only happens on `mode`, not on every
   * render, so a deliberate re-sort survives until the tab changes.
   */
  useEffect(() => {
    setSortKey("interest");
    setSortDir(defaultDir("interest", mode === "borrow"));
  }, [mode]);

  /*
   * Each tab is its own book, so the shared search atom is reset on every tab
   * change. The box renders only on /borrow and /lend; without this an id typed
   * on one would persist to the other — and to /mylends, which has no box to
   * clear it and would silently collapse to the one matching row (or none).
   * `setSearchById` is a Jotai setter, so its identity is stable and this fires
   * on `mode` alone, never on a keystroke.
   */
  useEffect(() => {
    filters?.setSearchById?.("");
  }, [mode, filters?.setSearchById]);

  const nowSec = Math.floor(Date.now() / 1000);
  const overdueCount = borrow.loans.filter((l) => l.overdue).length;
  const upcomingDue = borrow.loans
    .map((l) => Number(l.returnDate))
    .filter((t) => Number.isFinite(t) && t > nowSec);
  const nextDueTs = upcomingDue.length ? Math.min(...upcomingDue) : null;

  // borrow.loans is the user's own debt from loans they took out, so Obligations
  // belongs only on the borrower-side tabs. On /lend and /mylends the user acts
  // as a lender and their personal due dates have nothing to do with the view.
  const showObligations =
    (isBorrow || isMine) && (nextDueTs !== null || overdueCount > 0);

  // `book` is the live order book on /borrow and /lend but the user's own
  // listings on /mylends, where "Market" stats would just describe their own
  // offers back to them under a heading that claims otherwise.
  const showMarket = market !== null && !isMyLends;

  /* Null on the borrower tabs, and null when the fee is unread — same rule the
     per-row sub-line follows, for the same reason: a derived rate must vanish
     rather than degrade into the gross one. */
  const bestNetBps =
    isLenderRole && market !== null
      ? netLenderRateBps(Number(market.bestBps), borrow.fees.interestFeeBps)
      : null;

  // Collateral and health factor are what you borrow against, so the borrower
  // position card belongs on /borrow as well as /myloans — otherwise you have to
  // open the Collateral modal to see your health factor while browsing offers.
  // Not on /lend: funding someone else's request doesn't touch your collateral.
  const showBorrowerPosition = isMine || isBorrow;

  /*
   * The lender's own numbers for /mylends.
   *
   * `usdValue` is shared because both figures price a base-unit amount the same
   * way, and both were previously computed inline off `myListings`. The funded
   * pair was dead: it filtered listings for status SERVICED, and a listing is
   * only ever OPEN or CLOSED on-chain, so Funded and Outstanding always read
   * 0 / $0.00 no matter how much the user had lent. A funded loan is a request
   * row with `lender` set — see myFundedLoans in useDataFiltersPanel.
   */
  const usdValue = (tokenAddress: string, baseUnits: string | undefined) => {
    try {
      const amt =
        Number(
          ethers.formatUnits(
            baseUnits ?? "0",
            getTokenDecimals(READ_ONLY_CHAIN_ID, tokenAddress),
          ),
        ) || 0;
      /*
       * The native asset takes the native price, everything else takes the
       * dollar one — and `etherPrice` is misnamed rather than ETH-specific: it is
       * `getUsdValue(NATIVE_SENTINEL.lending, 1, 0)` off the diamond
       * (useGetValueAndHealth.ts:545), so it is BNB's price on BSC and USDC's on
       * Arc. Testing the sentinel is therefore correct on all five chains.
       *
       * It used to test `tokenImageMap[tokenAddress]?.label === "ETH"` against a
       * flat table of Abstract addresses. After the address cutover that table
       * matched nothing anywhere, so the branch was unreachable and EVERY row
       * priced at `usdcPrice ?? 1` — a native-denominated listing valued at a
       * dollar a token.
       */
      const price = isNativeSentinel(tokenAddress, "lending")
        ? Number(filters?.etherPrice ?? 0)
        : Number(filters?.usdcPrice ?? 1);
      return amt * price;
    } catch {
      return 0;
    }
  };

  // The borrow cursor asks for status OPEN, so this is the value still on offer
  // rather than everything ever posted — labelled accordingly below.
  const openValueUsd = myListings.reduce(
    (sum, li) => sum + usdValue(li.tokenAddress, li.amount),
    0,
  );
  const myOpenCount = myListings.length;

  const myFundedLoans = (filters?.myFundedLoans ?? []) as unknown as Row[];
  const funded = myFundedLoans.filter(
    (r) => String(r.status).toUpperCase() === "SERVICED",
  );
  const fundedCount = funded.length;
  // What the borrowers owe back, so principal plus interest — `amount` alone
  // understates a lender's position by exactly the interest they are lending at.
  const outstandingUsd = funded.reduce(
    (sum, r) => sum + usdValue(r.tokenAddress, r.totalRepayment ?? r.amount),
    0,
  );

  const asDays = (ts: number) => Math.max(0, Math.round((ts - nowSec) / 86400));
  const termLabel =
    market && market.minTerm !== null && market.maxTerm !== null
      ? asDays(market.minTerm) === asDays(market.maxTerm)
        ? `${asDays(market.minTerm)} days`
        : `${asDays(market.minTerm)}–${asDays(market.maxTerm)} days`
      : null;

  /*
   * Picked once instead of re-deriving `isBorrow ? … : …` at five use sites,
   * because /mylends is neither side of the book and every one of those
   * two-valued ternaries got it wrong: the tab announced "Loan requests", "N to
   * fund" and a "Borrower" column over the user's own lend offers.
   *
   * `party` names the address on the second line of the first column. On
   * /mylends that address is always the user, so there is no counterparty to
   * name and the column is titled by what it actually leads with.
   */
  const copy = isMyLends
    ? {
        title: "Your offers",
        count: "posted",
        party: "Asset",
        // myListings matches on the connected address, so with no wallet it is
        // empty for a reason that has nothing to do with what the user posted.
        emptyTitle: isConnected
          ? "You haven't posted an offer yet."
          : "Connect a wallet to see your offers.",
        emptySub: "Post one at the rate and term you want.",
      }
    : isBorrow
      ? {
          title: "Open offers",
          count: "to borrow from",
          party: "Lender",
          emptyTitle: "No offers right now.",
          emptySub: "Post your own at the rate and term you want.",
        }
      : {
          title: "Loan requests",
          count: "to fund",
          party: "Borrower",
          emptyTitle: "No requests right now.",
          emptySub: "Post your own at the rate and term you want.",
        };

  /* After every hook above, so the hook order never changes with the gate. */
  if (!gate.ready) {
    return (
      <ChainGate
        product={
          isMine
            ? "loans"
            : isMyLends
              ? "lends"
              : isBorrow
                ? "borrowing"
                : "lending"
        }
        state={gate}
      />
    );
  }

  return (
    <>
      <div className={s.cols}>
        {isMine ? (
          <div>
            <div className={s.gHead}>
              <span className={s.gTitle}>Your loans</span>
              <span className={s.gCount}>
                {borrow.loans.length} outstanding
              </span>
            </div>
            <div className={s.table}>
              {borrow.loans.length === 0 ? (
                <div className={s.empty}>
                  <div className={s.emptyTitle}>Nothing outstanding.</div>
                  <div className={s.emptySub}>
                    Loans you take will appear here with what you owe.
                  </div>
                </div>
              ) : (
                <div className={s.tw}>
                  <div className={`${s.tr} ${s.mineRow} ${s.thead}`}>
                    <span>Asset</span>
                    <span className={s.cellNum}>Owed</span>
                    <span className={s.cellNum}>APR</span>
                    <span className={s.cellNum}>Due</span>
                    <span />
                  </div>
                  {borrow.loans.map((loan) => (
                    <div
                      key={loan.requestId}
                      className={`${s.tr} ${s.mineRow}`}
                    >
                      <div className={s.asset}>
                        {/* Art by symbol, not by address. `loan.symbol` is
                            resolved chain-scoped in useBorrowV2 via
                            `declaredSymbol`; the src used to come from
                            `tokenImageMap[loan.tokenAddress]?.image`, a flat table
                            of Abstract addresses that matched nothing after the
                            cutover — so every row here drew the Eye placeholder.
                            It stays as the fallback for a token we cannot name. */}
                        <TokenIcon
                          symbol={loan.symbol}
                          size={32}
                          className={s.aImg}
                          fallback={
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className={s.aImg} src="/Eye.svg" alt="" />
                          }
                        />
                        <div className={s.aMeta}>
                          <div className={s.aName}>{loan.symbol}</div>
                          <div className={s.aSub}>
                            from{" "}
                            {loan.lender ? formatAddress(loan.lender) : "—"}
                          </div>
                        </div>
                      </div>
                      <span className={`${s.cellNum} tabular`}>
                        {Number(loan.totalRepayment).toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </span>
                      <span className={`${s.cellNum} tabular`}>
                        {convertbasisPointsToPercentage(loan.interestBps)}%
                      </span>
                      <span
                        className={`${s.cellNum} tabular ${loan.overdue ? s.rateBad : s.term}`}
                      >
                        {loan.overdue
                          ? "Overdue"
                          : getTimeUntil(loan.returnDate)}
                      </span>
                      <span className={s.actionCell}>
                        <button
                          className={s.actBtn}
                          disabled={!isConnected || repaying === loan.requestId}
                          onClick={() => onRepay(loan)}
                        >
                          {repaying === loan.requestId ? "Repaying…" : "Repay"}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div className={s.gHead}>
              <span className={s.gTitle}>{copy.title}</span>
              <span className={s.gCount}>
                {sorted.length} {copy.count}
              </span>
              {/* Not on /mylends: that tab filters the borrow cursor to the
                  user's own offers client-side, so an id search would hunt the
                  whole book while the view only shows a slice of it. Borrow and
                  lend are the cursor-backed books the searchId param actually
                  narrows. */}
              {!isMyLends && (
                <SearchBox
                  value={filters?.searchById ?? ""}
                  onChange={(v) => filters?.setSearchById?.(v)}
                  placeholder={isListingShape ? "Offer ID" : "Request ID"}
                />
              )}
            </div>

            <div className={s.table}>
              <div className={s.tw}>
                <div className={`${s.tr} ${s.thead}`}>
                  <span>{copy.party}</span>
                  <button
                    className={s.sortable}
                    onClick={() => sortBy("amount")}
                  >
                    Amount{sortMark("amount")}
                  </button>
                  <button
                    className={s.sortable}
                    onClick={() => sortBy("interest")}
                  >
                    APR{sortMark("interest")}
                  </button>
                  <button
                    className={s.sortable}
                    onClick={() => sortBy("returnDate")}
                  >
                    Term{sortMark("returnDate")}
                  </button>
                  <span className={s.center}>Status</span>
                  <span />
                </div>

                {loading &&
                  Array.from({ length: 5 }, (_, i) => (
                    <div key={`sk${i}`} className={s.tr}>
                      <div className={s.skRow}>
                        <span className={s.skCircle} />
                        <span className={s.skLine} />
                      </div>
                    </div>
                  ))}

                {!loading && sorted.length === 0 && (
                  <div className={s.empty}>
                    <div className={s.emptyTitle}>{copy.emptyTitle}</div>
                    <div className={s.emptySub}>{copy.emptySub}</div>
                  </div>
                )}

                {!loading &&
                  pageRows.map((row, i) => {
                    /*
                     * Name and art for the row's asset, resolved chain-scoped.
                     *
                     * This was `tokenImageMap[row.tokenAddress] ?? { image:
                     * "/Eye.svg", label: "—" }` — a flat address table of five
                     * Abstract-testnet literals. After the address cutover not one
                     * of its keys existed on any deployed chain, so the whole book
                     * fell to the fallback: every row on /borrow and /lend drew an
                     * Eye placeholder and named its currency "—". The decimals
                     * beside it were already resolving correctly, which is what
                     * made the mismatch easy to miss.
                     */
                    const symbol = declaredSymbol(
                      READ_ONLY_CHAIN_ID,
                      row.tokenAddress,
                    );
                    const isNative = isNativeSentinel(
                      row.tokenAddress,
                      "lending",
                    );
                    const decimals = getTokenDecimals(
                      READ_ONLY_CHAIN_ID,
                      row.tokenAddress,
                    );
                    const id = rowId(row);
                    const counterparty = isListingShape
                      ? row.sender
                      : row.author;
                    /*
                     * Every /mylends row is one of the user's own listings by
                     * construction, so own-row treatment there does not depend
                     * on the comparison below landing.
                     *
                     * Both sides have to be present for that comparison: with
                     * no wallet connected, or a row missing its address,
                     * undefined === undefined made every row look like the
                     * user's own and offered a Close that could only revert.
                     */
                    const isOwnRow =
                      isMyLends ||
                      (!!counterparty &&
                        !!filters?.address &&
                        counterparty.toLowerCase() ===
                          filters.address.toLowerCase());
                    const [, isOverdue] = getOverdue(Number(row.returnDate));
                    // The lend cursor fetches OPEN,SERVICED, so the request book
                    // carries rows that are already funded. Funding one reverts
                    // with Protocol__RequestNotOpen, and the button offering it
                    // was enabled — the status badge was the only warning.
                    const isOpen = String(row.status).toUpperCase() === "OPEN";
                    const apr = convertbasisPointsToPercentage(row.interest);
                    /* Null on the borrower tabs, and null when the fee could not
                       be read — the sub-line is a derived figure, so it has to
                       disappear rather than fall back to the gross rate. */
                    const netApr = isLenderRole
                      ? netLenderRateBps(
                          Number(row.interest),
                          borrow.fees.interestFeeBps,
                        )
                      : null;

                    let amount = "—";
                    try {
                      amount = formatWithCommas(
                        ethers.formatUnits(row.amount ?? "0", decimals),
                        /* Four places for the native asset, two for a dollar
                           token. Was `token.label === "ETH"`, which only ever
                           matched the Abstract sentinel row; the sentinel test is
                           the same intent and works on all five chains. */
                        isNative ? 4 : 2,
                      );
                    } catch {
                      amount = "—";
                    }

                    return (
                      <div
                        key={row.listingId ?? row.requestId ?? i}
                        className={s.tr}
                      >
                        <div className={s.asset}>
                          <TokenIcon
                            symbol={symbol}
                            size={32}
                            className={s.aImg}
                            fallback={
                              // eslint-disable-next-line @next/next/no-img-element
                              <img className={s.aImg} src="/Eye.svg" alt="" />
                            }
                          />
                          <div className={s.aMeta}>
                            <div className={s.aName}>{symbol ?? "—"}</div>
                            <div className={s.aSub}>
                              {counterparty ? formatAddress(counterparty) : "—"}
                              {isOwnRow && " · you"}
                            </div>
                          </div>
                        </div>
                        <span className={`${s.cellNum} tabular`}>{amount}</span>
                        <span
                          className={`${s.cellNum} ${s.cellStack} tabular ${rateClass(Number(row.interest))}`}
                        >
                          <span>{apr}%</span>
                          {netApr !== null && (
                            <span className={s.cellSub}>
                              {formatBps(netApr)} net
                            </span>
                          )}
                        </span>
                        <span className={`${s.cellNum} ${s.term} tabular`}>
                          {getTimeUntil(Number(row.returnDate)).replace(
                            / left$/,
                            "",
                          )}
                        </span>
                        <span className={s.center}>
                          <span
                            className={`${s.badge} ${
                              isOverdue
                                ? s.badgeBad
                                : row.status === "OPEN"
                                  ? s.badgeOpen
                                  : ""
                            }`}
                          >
                            {isOverdue ? "Overdue" : row.status || "—"}
                          </span>
                        </span>
                        <span className={s.actionCell}>
                          {isOwnRow ? (
                            <button
                              className={s.closeBtn}
                              disabled={!isConnected || pending === id}
                              onClick={() => closeRow(row)}
                            >
                              {pending === id ? "Closing…" : "Close"}
                            </button>
                          ) : (
                            <button
                              className={s.actBtn}
                              disabled={
                                isOverdue ||
                                !isConnected ||
                                pending === id ||
                                !isOpen
                              }
                              onClick={() =>
                                isListingShape ? openTake(row) : fundRow(row)
                              }
                            >
                              {pending === id
                                ? "Funding…"
                                : isListingShape
                                  ? "Borrow"
                                  : "Fund"}
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
              </div>

              {!loading && sorted.length > 0 && (pageCount > 1 || hasMore) && (
                <div className={s.pager}>
                  <button
                    className={s.pageBtn}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={curPage <= 1}
                  >
                    Prev
                  </button>
                  <span className={s.pageNow}>
                    Page {curPage} of {pageCount}
                  </span>
                  <button
                    className={s.pageBtn}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    disabled={curPage >= pageCount}
                  >
                    Next
                  </button>
                  {hasMore && (
                    <button
                      className={s.loadMore}
                      onClick={() => filters?.loadMore?.(100)}
                      disabled={loadingMore}
                    >
                      {loadingMore ? "Loading…" : "Load more"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <aside className={s.side}>
          {isMyLends ? (
            <div className={s.card}>
              <div className={s.cardTitle}>Your position</div>
              <div className={s.posRow}>
                <span className={s.cardBody}>Open value</span>
                <span className="tabular">
                  $
                  {openValueUsd.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className={s.posRow}>
                <span className={s.cardBody}>Open offers</span>
                <span className="tabular">{myOpenCount}</span>
              </div>
              <div className={s.posRow}>
                <span className={s.cardBody}>Funded</span>
                <span className="tabular">{fundedCount}</span>
              </div>
              <div className={s.posRow}>
                <span className={s.cardBody}>Outstanding</span>
                <span className="tabular">
                  $
                  {outstandingUsd.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>
          ) : showBorrowerPosition ? (
            <div className={s.card}>
              <div className={s.cardTitle}>Your position</div>
              <div className={s.posRow}>
                <span className={s.cardBody}>Collateral</span>
                <span className="tabular">
                  $
                  {borrow.collateralValueUsd.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className={s.posRow}>
                <span className={s.cardBody}>Health factor</span>
                <span
                  className={`tabular ${borrow.healthFactor !== null && borrow.healthFactor < 1.2 ? s.rateBad : ""}`}
                >
                  {borrow.healthFactor === null
                    ? "—"
                    : borrow.healthFactor.toFixed(2)}
                </span>
              </div>
              <div className={s.posRow}>
                <span className={s.cardBody}>Open loans</span>
                <span className="tabular">{borrow.loans.length}</span>
              </div>
            </div>
          ) : null}
          {showObligations && (
            <div className={s.card}>
              <div className={s.cardTitle}>Obligations</div>
              {nextDueTs !== null && (
                <div className={s.posRow}>
                  <span className={s.cardBody}>Next due</span>
                  <span className="tabular">
                    {untilShort(nextDueTs, nowSec)}
                  </span>
                </div>
              )}
              {overdueCount > 0 && (
                <div className={s.posRow}>
                  <span className={s.cardBody}>Overdue</span>
                  <span className={`tabular ${s.rateBad}`}>{overdueCount}</span>
                </div>
              )}
            </div>
          )}
          {showMarket && (
            <div className={s.card}>
              <div className={s.cardTitle}>Market</div>
              <div className={s.posRow}>
                <span className={s.cardBody}>
                  {isBorrow ? "Lowest APR" : "Highest APR"}
                </span>
                <span className="tabular">
                  {convertbasisPointsToPercentage(market.bestBps)}%
                </span>
              </div>
              {/* The best rate in the book, net of the protocol's cut, on the tab
                  where the viewer is the one it comes out of. "Highest APR" is
                  what the borrower pays; this is what the lender keeps. */}
              {isLenderRole && bestNetBps !== null && (
                <div className={s.posRow}>
                  <span className={s.cardBody}>Net to you</span>
                  <span className="tabular">{formatBps(bestNetBps)}</span>
                </div>
              )}
              {termLabel && (
                <div className={s.posRow}>
                  <span className={s.cardBody}>Terms</span>
                  <span className="tabular">{termLabel}</span>
                </div>
              )}
            </div>
          )}
          {/* Last in the aside, and on every tab: both rates apply to both roles,
              only the incidence differs. It sits below Market deliberately — the
              rates in the book are the headline, what the protocol takes out of
              them is the qualifier. */}
          <FeeCard fees={borrow.fees} lender={isLenderRole} />
        </aside>
      </div>
      <TakeLoanModal
        open={takeTarget !== null}
        onClose={() => setTakeTarget(null)}
        borrow={borrow}
        listing={takeTarget}
        onDone={onTakeDone}
      />
    </>
  );
}
