/**
 * Demo fixtures — the interface audit's missing half.
 *
 * WHY THIS EXISTS
 *
 * No contract is deployed anywhere. `DEPLOYMENTS` (constants/registry.ts:143) is
 * empty on purpose, so `getContracts(chainId)` returns `{}` for every chain and
 * every protocol read comes back null. That is honest, and it is also useless for
 * the thing we are actually doing right now: checking that all 23 routes render,
 * that each one is wired to a real read path, and that nothing is broken before
 * the first deploy. An empty table proves nothing — it looks identical whether
 * the page is correct, half-written, or throwing.
 *
 * So this module supplies the rows the chain cannot. Turn it on and every
 * surface fills in; turn it off and the app is back to reading only what is
 * really there.
 *
 * HOW TO REMOVE IT — the whole point of the design
 *
 *   1. Unset `NEXT_PUBLIC_MOCK_DATA` in `.env`. That alone disables everything
 *      here; the flag defaults to off, so a deploy that forgets step 2 is still
 *      correct.
 *   2. `rm -rf src/lib/mock`, then `npx tsc --noEmit`. The compiler enumerates
 *      every call site for you — there is no dynamic lookup anywhere in this
 *      module, by design, precisely so that deleting it cannot fail silently.
 *   3. At each error, delete the `if (MOCK_DATA)` block. Every one of them is a
 *      short-circuit at the top of a hook's return, never a branch woven through
 *      the real logic, so removal is always a deletion and never a rewrite.
 *
 * THE RULES THESE FIXTURES FOLLOW
 *
 * - **Read-only.** Nothing here is ever handed to a signer. The hooks below
 *   override only the fields a page *displays*; every write path — stake(),
 *   mint(), repay(), collect() — stays wired to the real contract call, because
 *   "is the integration there" is exactly what we are auditing. Press a button in
 *   demo mode and you get the real resolver's real failure, which is the useful
 *   answer.
 * - **Fixed timestamps, never `Date.now()`.** Several of these render inside
 *   server-rendered trees, and a duration computed from the clock differs between
 *   the server pass and hydration. See the dates in `lending.ts`.
 * - **Shaped exactly like the real thing.** Amounts are raw base units, health
 *   factors are unscaled, nullable fields are genuinely null in places. A fixture
 *   that skips the awkward cases would hide the bugs it exists to surface, so
 *   each product includes at least one unmeasurable figure and one adverse state
 *   (out of range, overdue, near liquidation).
 * - **Unlabelled in the UI, and that is a deliberate trade.** There is no demo
 *   banner: the app must read as the finished product, so nothing on screen is
 *   allowed to announce a pre-release state. That puts the whole burden of not
 *   shipping these numbers on the flag — `NEXT_PUBLIC_MOCK_DATA` is unset in
 *   `.env.example`, so it is off in any environment nobody deliberately turned it
 *   on in — and on step 2 above. Do not add a "this is demo data" note to a page
 *   to compensate.
 * - **Gates open only for the missing deployment.** `useChainGate` reports ready
 *   under this flag, because an empty-state panel where a table should be proves
 *   nothing about the table. "Connect a wallet" and "unrecognised network" stay
 *   shut: neither is about deployment, and an unrecognised network is a real
 *   misconfiguration a fixture must not paper over.
 * - **The wallet guards are not uniform, and the seams inherit that.**
 *   `useStablecoin`, `useV3Positions` and `usePortfolio` substitute only for a
 *   connected address, so their fixtures follow the page's own scoping.
 *   `useStakeV2`, `useBorrowV2`, `usePoolData` and the two book hooks substitute
 *   with or without a wallet — the first two because their spread is
 *   unconditional, the rest because they are protocol-wide reads that never
 *   needed an address. Checked seam by seam; see `docs/interface-inventory.md` §7.
 */

/**
 * Whether to serve fixtures in place of contract reads.
 *
 * Read from the environment rather than a code constant so switching it does not
 * need an edit, and read *once* here so no call site has to remember the exact
 * spelling. Any value other than the two below — including unset, which is the
 * production case — leaves it off.
 */
export const MOCK_DATA =
  process.env.NEXT_PUBLIC_MOCK_DATA === "1" ||
  process.env.NEXT_PUBLIC_MOCK_DATA === "true";

export { MOCK_POOLS, mockPoolTxns } from "./pools";
export { MOCK_V3_POSITIONS } from "./positions";
/*
 * `mockListings`/`mockRequests` are functions, not constants, because the
 * personal views — /mylends, /myloans, funded loans — filter on the connected
 * address, and a fixture cannot know it at module scope. They re-attribute the
 * rows marked as the viewer's, and reproduce each endpoint's own selection rules
 * — status defaults, owner match, id search — so a hook serving fixtures still
 * exercises the real filtering contract.
 */
export {
  MOCK_LISTINGS,
  MOCK_REQUESTS,
  MOCK_LOANS,
  MOCK_COLLATERAL,
  MOCK_LENDING_ASSETS,
  MOCK_LENDING_FEES,
  MOCK_VIEWER,
  mockListings,
  mockRequests,
} from "./lending";
export { MOCK_STAKE } from "./stake";
export {
  MOCK_STABLE_STATS,
  MOCK_STABLE_BALANCES,
  MOCK_STABLE_REWARDS,
  MOCK_STABLE_WITHDRAWAL,
  MOCK_STABLE_IDLE,
} from "./stable";
export { MOCK_PORTFOLIO } from "./portfolio";
export { MOCK_MARKET } from "./market";
/*
 * The last six seams are functions rather than constants, for three different
 * reasons. `mockBalance` and the two quote helpers answer about a token or a pair
 * the caller names, which no constant can enumerate. `mockLeaderboard` and
 * `mockStanding` answer about a season, and the standing re-attributes its row to
 * the wallet that asked. `mockNotifications` and `mockTxLog` are per-wallet stores
 * whose seams clear when no wallet is connected, so each takes the scope its own
 * hook is keyed to and returns nothing without it.
 */
export { mockBalance } from "./balances";
export { mockQuote, mockQuoteMultiHop } from "./quotes";
export { mockLeaderboard, mockStanding } from "./points";
/*
 * `mockTxLogClear` is the one export here that mutates. TxHistory's Clear button
 * has to visibly work — a control that does nothing is the class of break this
 * flag exists to rule out — so the fixture log remembers, for this page load only,
 * that it was cleared. See the note beside it.
 */
export { mockNotifications, mockTxLog, mockTxLogClear } from "./activity";
