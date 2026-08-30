import { parseUnits } from "ethers";

import type { LoanListing, Request } from "@/constants/types";
import type { ActiveLoan, CollateralHolding } from "@/hooks/v2/useBorrowV2";
import type { LendingAsset } from "@/lib/lending/assets";
import type { LendingFeeRates } from "@/lib/lending/fees";
import {
  borrowCurrencies,
  declaredSymbol,
  NATIVE_SENTINEL,
} from "@/constants/registry";
import { READ_ONLY_CHAIN_ID } from "@/config/provider";

/**
 * Demo lending book — listings, requests, the viewer's own loans, and collateral.
 *
 * ADDRESSES HERE ARE THE REAL ONES, unlike the DEX fixtures, and they are now
 * READ OUT OF THE DEPLOYMENT RECORD rather than written down. They used to be
 * four Abstract-testnet literals copied verbatim from
 * `constants/utils/tokenImageMap.ts`, because that flat address → label table was
 * what the book and `useBorrowV2` looked a row's name up in, and an address
 * outside it rendered as "—" beside a placeholder eye icon.
 *
 * That table is gone. Both surfaces resolve a row through
 * `declaredSymbol(chainId, address)` now, so matching them means holding the read
 * chain's own addresses — which is the better arrangement anyway: these fixtures
 * exercise the real resolver instead of agreeing with a parallel copy of it. A
 * currency the read chain has no deployment for drops out of `borrowCurrencies`
 * and its rows honestly show "—", which is what an unregistered token does in
 * production. All four are present on Sepolia (deployments.generated.ts:107-126).
 *
 * UNITS ARE THE AWKWARD PART, and getting them wrong is the whole reason to
 * write them down. `Request` has two producers with two different conventions:
 *
 *   /api/requests   → `amount` and `totalRepayment` are BASE UNITS as text, and
 *                     `status` is "OPEN" | "SERVICED" | "CLOSED".
 *                     (supabase/migrations/20260731000000_kaleido_core_tables.sql:73-87)
 *   useGetActiveRequest → `amount` is base units, but `totalRepayment` is already
 *                     run through `formatUnits` (:44), and `status` is the enum
 *                     ordinal stringified: "0" | "1" | "2" (:48).
 *
 * MOCK_LISTINGS and MOCK_REQUESTS stand in for the API, so they follow the first
 * convention. MOCK_LOANS stands in for `useBorrowV2`, which maps the second, so
 * its `totalRepayment` is a decimal string and `totalRepaymentRaw` is that value
 * back through `parseUnits`. The mismatch is not hypothetical: `usePortfolio` used
 * to run this producer's already-formatted `totalRepayment` through `formatUnits`
 * a second time, which threw `invalid BigNumberish string` and hung the whole page
 * on a spinner for anyone holding a loan. Its debt pricing now takes the value as
 * a decimal and says at the call site which of the two conventions it is reading.
 *
 * `interest` IS BASIS POINTS, not a percentage: `convertbasisPointsToPercentage`
 * divides by 100 (FormatInterestRate.ts:6), so 850 renders as 8.50%.
 *
 * TIMESTAMPS ARE FIXED, never `Date.now()`. `BorrowBookView` renders a live
 * countdown per row, and a clock-derived duration differs between the server
 * pass and hydration. 1783641600 is 2026-07-10 — in the past, so those rows
 * show the Overdue badge; 1796083200 is 2026-12-01, 1799971200 is 2027-01-15,
 * and 1811808000 is 2027-06-01.
 */

/**
 * The read chain's lending currencies, by symbol.
 *
 * Exact case as `borrowCurrencies` declares it, since that is what the UI
 * compares and renders. A symbol with no deployment resolves to the empty string
 * rather than to some other token's address: a fixture row that cannot be named
 * is a visibly incomplete demo, and a fixture row wearing the wrong asset's
 * address is a demo that lies about which token it is.
 */
const LENDING = borrowCurrencies(READ_ONLY_CHAIN_ID);
const addressOf = (symbol: string) =>
  LENDING.find((c) => c.symbol === symbol)?.address ?? "";

const USDC = addressOf("USDC");
const ETH = NATIVE_SENTINEL.lending;
const kfUSD = addressOf("kfUSD");
const USDT = addressOf("USDT");

/** Resolved the same way the book resolves it, so the two cannot disagree. */
const labelOf = (address: string) =>
  declaredSymbol(READ_ONLY_CHAIN_ID, address) ?? "—";

/**
 * Stand-in for the connected wallet.
 *
 * `/mylends`, `/myloans` and the funded-loans list all filter on the connected
 * address — `listing.sender`, `request.author`, `request.lender` — so a fixture
 * owned by a stranger populates the public book and leaves every personal view
 * empty, which is precisely the half of the audit that needs proving. Rows
 * carrying this sentinel are re-attributed to the real address by `mockListings`
 * and `mockRequests` below. With no wallet connected they stay as they are, and
 * read as somebody else's orders, which is honest.
 */
export const MOCK_VIEWER = `0x${"5eed".repeat(10)}`;

/** Counterparties: `0xbeef…000N`, lowercase for the usual checksum reason. */
const party = (n: number) =>
  `0x${"beef".repeat(9)}${String(n).padStart(4, "0")}`;

/** The lender field before anyone fills the request. */
const NO_LENDER = "0x0000000000000000000000000000000000000000";

const raw = (amount: string, token: string) =>
  parseUnits(amount, token === ETH || token === kfUSD ? 18 : 6).toString();

const DEC_2026_01 = 1796083200; // 2026-12-01
const JAN_2027_15 = 1799971200; // 2027-01-15
const JUN_2027_01 = 1811808000; // 2027-06-01
const PAST = 1783641600; // 2026-07-10 — renders as overdue

/**
 * Lend offers, as /api/listings returns them.
 *
 * `min_amount`/`max_amount` bound what a single borrower may draw, so they are
 * always below `amount`; a fixture that ignored that would let the UI offer a
 * fill the contract rejects.
 */
export const MOCK_LISTINGS: LoanListing[] = [
  {
    listingId: 3041,
    sender: party(1),
    tokenAddress: USDC,
    amount: raw("250000", USDC),
    min_amount: raw("1000", USDC),
    max_amount: raw("50000", USDC),
    returnDate: DEC_2026_01,
    interest: 850,
    status: "OPEN",
  },
  {
    listingId: 3042,
    sender: party(2),
    tokenAddress: ETH,
    amount: raw("42.5", ETH),
    min_amount: raw("0.25", ETH),
    max_amount: raw("10", ETH),
    returnDate: JAN_2027_15,
    interest: 610,
    status: "OPEN",
  },
  {
    // 18-decimal stable: the amount is the longest string in the book.
    listingId: 3043,
    sender: party(3),
    tokenAddress: kfUSD,
    amount: raw("180000", kfUSD),
    min_amount: raw("500", kfUSD),
    max_amount: raw("25000", kfUSD),
    returnDate: JUN_2027_01,
    interest: 1120,
    status: "OPEN",
  },
  {
    listingId: 3044,
    sender: party(4),
    tokenAddress: USDT,
    amount: raw("96500", USDT),
    min_amount: raw("2500", USDT),
    max_amount: raw("20000", USDT),
    returnDate: DEC_2026_01,
    interest: 480,
    status: "OPEN",
  },
  {
    // The viewer's own offer — this is what /mylends exists to show.
    listingId: 3045,
    sender: MOCK_VIEWER,
    tokenAddress: USDC,
    amount: raw("60000", USDC),
    min_amount: raw("1000", USDC),
    max_amount: raw("15000", USDC),
    returnDate: JAN_2027_15,
    interest: 725,
    status: "OPEN",
  },
  {
    // Viewer's, and past its return date: the Overdue badge should appear.
    listingId: 3046,
    sender: MOCK_VIEWER,
    tokenAddress: ETH,
    amount: raw("8", ETH),
    min_amount: raw("0.1", ETH),
    max_amount: raw("4", ETH),
    returnDate: PAST,
    interest: 900,
    status: "OPEN",
  },
  {
    /*
     * Closed. The book requests status=OPEN (EnhancedCardlayout.tsx:72), so this
     * row must NOT appear on /borrow — it is here to prove the status filter is
     * actually applied rather than assumed, which an all-OPEN fixture cannot show.
     */
    listingId: 3047,
    sender: party(5),
    tokenAddress: USDT,
    amount: raw("30000", USDT),
    min_amount: raw("500", USDT),
    max_amount: raw("5000", USDT),
    returnDate: DEC_2026_01,
    interest: 540,
    status: "CLOSE",
  },
];

/**
 * Borrow requests, as /api/requests returns them: base units throughout, and
 * `totalRepayment` = principal × (1 + interest/10000), which the borrow book
 * displays beside the principal. A row whose repayment did not follow from its
 * own interest rate would be visibly wrong on screen.
 *
 * An OPEN request has no lender yet — hence the zero address, which is what
 * `useDataFilterPanel.ts:212` relies on when it derives funded loans.
 */
export const MOCK_REQUESTS: Request[] = [
  {
    listingId: 3041,
    requestId: 5120,
    author: party(6),
    amount: raw("12000", USDC),
    interest: 850,
    totalRepayment: raw("13020", USDC),
    returnDate: DEC_2026_01,
    lender: party(1),
    tokenAddress: USDC,
    status: "SERVICED",
  },
  {
    // The viewer borrowing: shows up in /myloans and in MOCK_LOANS below.
    listingId: 3042,
    requestId: 5121,
    author: MOCK_VIEWER,
    amount: raw("3.5", ETH),
    interest: 610,
    totalRepayment: raw("3.7135", ETH),
    returnDate: JAN_2027_15,
    lender: party(2),
    tokenAddress: ETH,
    status: "SERVICED",
  },
  {
    // Unfilled, so no lender and no listing it was drawn from.
    listingId: 0,
    requestId: 5122,
    author: party(7),
    amount: raw("25000", kfUSD),
    interest: 1120,
    totalRepayment: raw("27800", kfUSD),
    returnDate: JUN_2027_01,
    lender: NO_LENDER,
    tokenAddress: kfUSD,
    status: "OPEN",
  },
  {
    // Funded BY the viewer — this is the row the funded-loans view filters for.
    listingId: 3044,
    requestId: 5123,
    author: party(8),
    amount: raw("8000", USDT),
    interest: 480,
    totalRepayment: raw("8384", USDT),
    returnDate: DEC_2026_01,
    lender: MOCK_VIEWER,
    tokenAddress: USDT,
    status: "SERVICED",
  },
  {
    // Funded by the viewer and overdue: the lender's adverse case.
    listingId: 3045,
    requestId: 5124,
    author: party(9),
    amount: raw("15000", USDC),
    interest: 725,
    totalRepayment: raw("16087.5", USDC),
    returnDate: PAST,
    lender: MOCK_VIEWER,
    tokenAddress: USDC,
    status: "SERVICED",
  },
  {
    listingId: 0,
    requestId: 5125,
    author: party(10),
    amount: raw("1.25", ETH),
    interest: 900,
    totalRepayment: raw("1.3625", ETH),
    returnDate: JAN_2027_15,
    lender: NO_LENDER,
    tokenAddress: ETH,
    status: "OPEN",
  },
  {
    listingId: 3043,
    requestId: 5126,
    author: MOCK_VIEWER,
    amount: raw("4200", USDT),
    interest: 540,
    totalRepayment: raw("4426.8", USDT),
    returnDate: DEC_2026_01,
    lender: party(3),
    tokenAddress: USDT,
    status: "SERVICED",
  },
  {
    // The viewer's overdue debt. Mirrored in MOCK_LOANS so the two agree.
    listingId: 3041,
    requestId: 5127,
    author: MOCK_VIEWER,
    amount: raw("9000", USDC),
    interest: 755,
    totalRepayment: raw("9679.5", USDC),
    returnDate: PAST,
    lender: party(4),
    tokenAddress: USDC,
    status: "SERVICED",
  },
];

/**
 * The query the two book endpoints accept, as far as row selection goes.
 *
 * A superset of what either route reads, so `FetchParams` from
 * useFetchRequestWithCursor.ts passes straight through. `sortBy`/`sortOrder` are
 * absent on purpose: ordering is the one thing the fixtures do not reproduce,
 * and a filter that silently ignored a sort would be worse than one that never
 * offered it.
 */
export interface MockBookFilter {
  status?: string;
  tokenAddress?: string;
  author?: string;
  lender?: string;
  sender?: string;
  search?: string;
  searchId?: string;
}

/**
 * The routes match addresses with `ilike` and no wildcards
 * (requests/route.ts:99, listings/route.ts:77), which is case-insensitive
 * equality — so a fixture must match a checksummed wallet address too.
 */
const sameAddress = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Mirrors parseBookIdSearch (src/lib/supabase/bookQuery.ts:40): digits only,
 * leading zeros stripped, anything else impossible — and an impossible id
 * returns no rows at all rather than falling back to the unfiltered book.
 */
const idSearch = (raw?: string) => {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return { kind: "none" as const };
  if (!/^\d+$/.test(trimmed)) return { kind: "impossible" as const };
  return { kind: "exact" as const, value: BigInt(trimmed).toString() };
};

/**
 * Which statuses /api/requests would return (route.ts:70-89).
 *
 * The default is not "all": with no status param the endpoint serves OPEN and
 * SERVICED only, and widens to include CLOSED when an owner filter is present.
 * A fixture book that ignored that would show /borrow rows the live API hides.
 */
const REQUEST_STATUSES = ["OPEN", "SERVICED", "CLOSED"];
const REQUEST_DEFAULT_STATUSES = ["OPEN", "SERVICED"];

const requestStatuses = (statusParam?: string, owned?: boolean) => {
  if (statusParam) {
    const requested = statusParam
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const allowed = requested.filter((s) => REQUEST_STATUSES.includes(s));
    return allowed.length ? allowed : REQUEST_DEFAULT_STATUSES;
  }
  return owned ? REQUEST_STATUSES : REQUEST_DEFAULT_STATUSES;
};

/**
 * /api/listings, as a function of the same query string the hook would send.
 *
 * Two jobs. It re-attributes the sentinel-owned rows to the connected wallet —
 * before filtering, so an owner filter matches them — and it then applies the
 * endpoint's own selection rules: `status` is a single case-sensitive `eq` here
 * (listings/route.ts:74, unlike the requests route's list), `sender` is an
 * owner match, `search` is a substring of the sender, and `searchId` is an
 * exact id. Filtering here rather than at the call site is the point: the hooks
 * keep exercising the real contract, so a view that would come back empty
 * against the live API comes back empty against the fixtures too.
 */
export const mockListings = (
  viewer?: string,
  filter: MockBookFilter = {},
): LoanListing[] => {
  const id = idSearch(filter.searchId);
  if (id.kind === "impossible") return [];
  const needle = filter.search?.toLowerCase();

  return MOCK_LISTINGS.map((l) =>
    viewer && l.sender === MOCK_VIEWER ? { ...l, sender: viewer } : l,
  ).filter((l) => {
    if (filter.status && l.status !== filter.status) return false;
    if (filter.tokenAddress && l.tokenAddress !== filter.tokenAddress)
      return false;
    if (filter.sender && !sameAddress(l.sender, filter.sender)) return false;
    if (needle && !l.sender.toLowerCase().includes(needle)) return false;
    if (id.kind === "exact" && String(l.listingId) !== id.value) return false;
    return true;
  });
};

/**
 * /api/requests, likewise. Differs from listings in three ways, all of them the
 * endpoint's: status is a comma-separated allowlist with a default, there are
 * two owner fields, and `search` matches either of them (route.ts:180).
 */
export const mockRequests = (
  viewer?: string,
  filter: MockBookFilter = {},
): Request[] => {
  const id = idSearch(filter.searchId);
  if (id.kind === "impossible") return [];
  const statuses = requestStatuses(
    filter.status,
    !!filter.author || !!filter.lender,
  );
  const needle = filter.search?.toLowerCase();

  return MOCK_REQUESTS.map((r) => ({
    ...r,
    author: viewer && r.author === MOCK_VIEWER ? viewer : r.author,
    lender: viewer && r.lender === MOCK_VIEWER ? viewer : r.lender,
  })).filter((r) => {
    if (!statuses.includes(r.status.toUpperCase())) return false;
    if (filter.tokenAddress && r.tokenAddress !== filter.tokenAddress)
      return false;
    if (filter.author && !sameAddress(r.author, filter.author)) return false;
    if (filter.lender && !sameAddress(r.lender, filter.lender)) return false;
    if (
      needle &&
      !r.author.toLowerCase().includes(needle) &&
      !r.lender.toLowerCase().includes(needle)
    )
      return false;
    if (id.kind === "exact" && String(r.requestId) !== id.value) return false;
    return true;
  });
};

/**
 * The viewer's open loans, shaped as `useBorrowV2` maps them — so
 * `totalRepayment` is human-readable and `totalRepaymentRaw` is the base-unit
 * value the contract needs, because a rounded repayment underpays and the loan
 * will not close.
 *
 * `status` is the enum ordinal, matching useGetActiveRequest:48. Nothing renders
 * it today (the loans table shows the return date instead), and the hook's own
 * `parseStatus` helper at :63 is dead code — noted here so the next reader knows
 * "1" is deliberate rather than a typo for "SERVICED".
 *
 * `overdue` is set explicitly. The real hook derives it from `Date.now()`; a
 * fixture must not, or the row's text differs between server and client.
 */
export const MOCK_LOANS: ActiveLoan[] = [
  {
    requestId: 5121,
    amount: raw("3.5", ETH),
    totalRepayment: "3.7135",
    totalRepaymentRaw: raw("3.7135", ETH),
    interestBps: 610,
    returnDate: JAN_2027_15,
    lender: party(2),
    tokenAddress: ETH,
    symbol: labelOf(ETH),
    status: "1",
    overdue: false,
  },
  {
    requestId: 5126,
    amount: raw("4200", USDT),
    totalRepayment: "4426.8",
    totalRepaymentRaw: raw("4426.8", USDT),
    interestBps: 540,
    returnDate: DEC_2026_01,
    lender: party(3),
    tokenAddress: USDT,
    symbol: labelOf(USDT),
    status: "1",
    overdue: false,
  },
  {
    requestId: 5127,
    amount: raw("9000", USDC),
    totalRepayment: "9679.5",
    totalRepaymentRaw: raw("9679.5", USDC),
    interestBps: 755,
    returnDate: PAST,
    lender: party(4),
    tokenAddress: USDC,
    symbol: labelOf(USDC),
    status: "1",
    overdue: true,
  },
];

/**
 * Deposited collateral. `amount` is a display number here, not base units —
 * `useBorrowV2` builds these from the already-formatted balance atoms
 * (useBorrowV2.ts:170).
 *
 * Three rows, not five: the real hook lists all five lending currencies and then
 * drops the empty ones (`.filter((c) => c.amount > 0)`, :175), so a zero-balance
 * row is a shape it never emits. USDR and USDT are therefore absent rather than
 * present-at-zero, and ./portfolio's collateral rows match one for one.
 *
 * These three priced at ./pools' assumed rates come to $34,780, which is the
 * `collateralUsd` the portfolio fixture reports.
 */
export const MOCK_COLLATERAL: CollateralHolding[] = [
  { symbol: "ETH", address: ETH, amount: 4.2 },
  { symbol: "USDC", address: USDC, amount: 12000 },
  { symbol: "kfUSD", address: kfUSD, amount: 8500 },
];

/**
 * What the fixture "diamond" accepts — the stand-in for useLendingAssets.
 *
 * All four tokens the book above is denominated in, not just the three with a
 * deposited balance. BorrowBookView resolves a row's asset out of this list before
 * it will open the Take modal, and the modals build their pickers from it, so a
 * USDT listing with no entry here would render in the book and then refuse to be
 * taken. It is deliberately a superset of MOCK_COLLATERAL for that reason: the
 * registered set and the deposited set are different facts, which is the whole
 * distinction useLendingAssets exists to keep.
 *
 * Decimals are stated, not derived from the symbol — the same rule the real path
 * follows (constants/registry.ts, rule 2). Both lists are the same here because a
 * fixture has no chain to disagree with; on every deployed chain they differ.
 */
export const MOCK_LENDING_ASSETS: LendingAsset[] = [
  { symbol: "ETH", address: ETH, decimals: 18, isNative: true },
  { symbol: "USDC", address: USDC, decimals: 6, isNative: false },
  { symbol: "USDT", address: USDT, decimals: 6, isNative: false },
  { symbol: "kfUSD", address: kfUSD, decimals: 18, isNative: false },
];

/**
 * The two lending fees, at the values every deployed diamond actually holds.
 *
 * Real figures rather than round demo ones, measured on all five chains
 * 2026-08-24 (`getBPS()` 1000, `getLiquidityBPS()` 640 everywhere). A fee
 * disclosure that shows a made-up rate in demo mode is worse than one that shows
 * nothing, because the number is the whole content of the disclosure.
 */
export const MOCK_LENDING_FEES: LendingFeeRates = {
  interestFeeBps: 1000,
  liquidationPenaltyBps: 640,
};
