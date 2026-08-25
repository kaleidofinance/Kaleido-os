import type { Notification } from "@/context/NotificationsContext";
import type { TxLogEntry } from "@/lib/v2/txLog";

/**
 * The two per-wallet stores: the notification inbox, and this device's tx log.
 *
 * Neither is a contract read, so neither is empty for the usual reason. The inbox
 * is fed by a WebSocket at `NEXT_PUBLIC_API_BASE`, which is set in no env file, so
 * the transport effect returns before it connects and the only rows that ever
 * appear are the ones `emit.ts` raises in this browser — which, with no positions
 * to warn about, is none. The tx log is written only by PlanReview after a
 * signature, so on a fresh machine it is empty by definition. /notifications shows
 * "No notifications", the bell sits at zero, and TxHistory's clock has no badge.
 *
 * Between them that leaves unexercised: four category tabs, three status filters,
 * five level filters, the unread styling, the Approve/Deny pair, the resolved
 * chips, the whole PlanReview screen at /notifications, and every row TxHistory
 * can draw including its reverted badge and its explorer links.
 *
 * IDS ARE PREFIXED `mock-`, AND THAT IS LOAD-BEARING. The inbox persists to
 * localStorage through `commit`, so marking a fixture row read would write it to a
 * key that outlives the flag — turn the flag off and yesterday's fixtures are
 * still in the bell, now with no code left that explains them. `loadStored` drops
 * `mock-` ids unconditionally (not behind MOCK_DATA, so it keeps working after this
 * directory is deleted), which is what makes seeding safe. The cost is that read
 * state on a fixture row resets on reload, which is the right trade.
 *
 * THE TX LOG IS NOT SEEDED INTO STORAGE, for the same reason inverted: a tx row is
 * keyed by its hash and a hash cannot carry a prefix without ceasing to be 64 hex
 * digits, so there would be no way to recognise a fixture row later. It is
 * substituted at the read instead, which never touches the key.
 *
 * NOTHING HERE IS DELIVERED. Seeding goes straight into state rather than through
 * `commitAndDeliver`, so no chime and no OS toast — ten of them on every mount,
 * fired by rows that are not news, is the one thing a notification centre must not
 * do.
 */

/* --------------------------------------------------------------- timestamps -- */

/**
 * 2026-08-19T08:00:00.000Z, in milliseconds.
 *
 * Every row below is an offset from this, never from the clock. Both renderers
 * compute "3h ago" from `Date.now()` at render time, so the ages drift forward as
 * the fixture ages — which is correct: these are records of things that happened
 * at a fixed moment, and a fixture that reset its own timestamps would be claiming
 * the agent asked again every time the page reloaded.
 */
const AS_OF = 1_787_126_400_000;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------ notifications -- */

/**
 * The plan the agent is asking to run.
 *
 * ONE STEP, WHERE THE SWAP CARD BUILDS TWO. A real WETH→USDC plan is an approve
 * followed by a swap, and the approve is deliberately absent: `intents` is the one
 * field in this whole directory that reaches a signer — press Review, then Sign &
 * execute, and PlanReview hands it to `resolveIntent` — and the approve resolver
 * calls `approve` on the token itself, which is a live contract on every chain the
 * app lists. That would be a fixture able to grant a real allowance. The swap
 * resolver instead calls this intent's `spender`, which is the zero address here,
 * so the step reverts at gas estimation and nothing is signed — the same real
 * failure the module header promises for every other write path under this flag.
 *
 * Mainnet token addresses and real decimals, so the row PlanReview renders is a
 * truthful description of the swap it would attempt rather than a plausible-looking
 * one — and they exist on no testnet either, a second reason the write can never
 * land. 0.05 WETH is chosen small for the same care.
 */
const SWAP_PLAN = [
  {
    kind: "swap" as const,
    tokenIn: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    tokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    /* Zero address: no router. The swap resolver builds a contract here and
       reverts at gas estimation, so this fixture can never send a transaction —
       see the header above. */
    spender: "0x0000000000000000000000000000000000000000",
    amountIn: "0.05",
    /* 0.05 × $3,400, less 0.5% slippage — ./quotes' price for an ether. */
    amountOutMin: "169.15",
    /* Hundredths of a bip. 500 is the 0.05% tier, where WETH/USDC size sits. */
    fee: 500,
    decimalsIn: 18,
    decimalsOut: 6,
    symbolIn: "WETH",
    symbolOut: "USDC",
  },
];

/**
 * Ten rows: every category, every level, both request kinds, both resolved chips.
 *
 * Newest first, which is the order the store keeps and the panel renders in.
 * `origin` is "remote" on all of them — not strictly true of anything, since no
 * server sent them, but "local" specifically means "raised in this browser by
 * emit.ts and the server has never heard of it", and the history merge treats the
 * two differently. Remote is the closer description of a row that arrived from
 * outside, and under this flag the merge is never reached anyway.
 */
const ROWS: Omit<Notification, "category">[] = [
  {
    id: "mock-agent-plan",
    title: "Luca has a plan ready",
    body: "Rotate 0.05 WETH into USDC ahead of the funding reset. One step, ready to sign.",
    level: "info",
    timestamp: AS_OF - 4 * MIN,
    read: false,
    actionType: "plan_ready",
    request: {
      kind: "plan",
      summary: "Swap 0.05 WETH for USDC at the 0.05% fee tier.",
      intents: SWAP_PLAN,
      status: "pending",
    },
    origin: "remote",
  },
  {
    id: "mock-agent-limit",
    title: "Luca is asking to raise a limit",
    /* Against the $1,000 default in useAgentSettings, so the ask is a real
       increase and the toast that follows reads as a change. */
    body: "The next rebalance needs $2,500 in one action. Your per-action cap is $1,000.",
    level: "warning",
    timestamp: AS_OF - 26 * MIN,
    read: false,
    actionType: "permission_request",
    request: {
      kind: "limit",
      summary: "Raise the per-action cap to $2,500.",
      limit: { field: "maxPerAction", requested: 2_500 },
      status: "pending",
    },
    origin: "remote",
  },
  {
    id: "mock-risk-health",
    title: "Health factor 1.18",
    body: "Your ETH-backed USDC loan is close to the liquidation threshold. Add collateral or repay to move it up.",
    level: "warning",
    timestamp: AS_OF - 2 * HOUR,
    read: false,
    actionType: "health_factor_warning",
    origin: "remote",
  },
  {
    id: "mock-order-request",
    title: "New borrow request you can fill",
    body: "96,500 USDT wanted at 7% until 24 September. Your idle USDT covers it.",
    level: "info",
    timestamp: AS_OF - 5 * HOUR,
    read: false,
    actionType: "new_borrow_request",
    origin: "remote",
  },
  {
    /* An action_type BY_ACTION_TYPE has never heard of. It lands in System rather
       than vanishing, which is the fallback taxonomy.ts documents and the one
       behaviour a fixture full of known values would never show. */
    id: "mock-system-epoch",
    title: "Points epoch settled",
    body: "Season 2, epoch 41. Balances updated for every ranked wallet.",
    level: "info",
    timestamp: AS_OF - 9 * HOUR,
    read: false,
    actionType: "epoch_settled",
    origin: "remote",
  },
  {
    id: "mock-order-filled",
    title: "Your lending offer was filled",
    body: "60,000 USDC drawn against listing #12 at 6.5%. Interest accrues from now.",
    level: "success",
    timestamp: AS_OF - 22 * HOUR,
    read: true,
    actionType: "loan_filled",
    origin: "remote",
  },
  {
    id: "mock-agent-done",
    title: "Luca compounded your kfUSD yield",
    body: "Claimed 184.20 kfUSD and re-locked it into the vault.",
    level: "success",
    timestamp: AS_OF - 1 * DAY - 3 * HOUR,
    read: true,
    actionType: "agent_action",
    request: {
      kind: "plan",
      summary: "Claim and compound kfUSD yield.",
      intents: [],
      status: "approved",
    },
    origin: "remote",
  },
  {
    id: "mock-risk-liq",
    title: "Position liquidated",
    body: "Loan #874 was closed by a liquidator. 2.4 ETH of collateral was sold to cover 7,900 USDC.",
    level: "error",
    timestamp: AS_OF - 2 * DAY,
    read: true,
    actionType: "liquidation",
    origin: "remote",
  },
  {
    id: "mock-agent-denied",
    title: "Luca asked to raise your daily cap",
    body: "Requested $12,000 per day for a multi-leg rotation.",
    level: "info",
    timestamp: AS_OF - 3 * DAY,
    read: true,
    actionType: "permission_request",
    request: {
      kind: "limit",
      summary: "Raise the daily cap to $12,000.",
      limit: { field: "maxPerDay", requested: 12_000 },
      status: "denied",
    },
    origin: "remote",
  },
  {
    /* No actionType at all — the other half of `categorise`'s fallback, and the
       shape every notification had before the taxonomy existed. */
    id: "mock-system-upgrade",
    title: "Router upgraded to 1.5.15",
    body: "Quotes and swaps now route through the hardened V3 periphery. No action needed.",
    level: "info",
    timestamp: AS_OF - 5 * DAY,
    read: true,
    origin: "remote",
  },
];

/**
 * The fixture inbox, for a connected wallet.
 *
 * `category` is deliberately not written above: `loadStored` re-derives it from
 * `actionType` on every load precisely so one rule lives in one place, and a
 * fixture that hard-coded the answer could disagree with `categorise` — which is
 * the mapping the rows above exist to demonstrate. The caller applies it, exactly
 * as the WebSocket handler and the history mapper do.
 *
 * The wallet is not used. Unlike the lending fixtures, nothing here is attributed
 * to an address: the store is already keyed to the connected wallet by the effect
 * that seeds it, and a notification carries no owner field to re-point. It is taken
 * as an argument because the seam has one, and because a fixture inbox for no
 * wallet is a thing this must never return — the store clears in that case, on
 * purpose, so the previous user's inbox is not shown to the next one.
 */
export function mockNotifications(
  wallet: string | undefined,
): Omit<Notification, "category">[] {
  if (!wallet) return [];
  return ROWS;
}

/* ---------------------------------------------------------------- tx log -- */

/**
 * Fabricated but well-formed: 60 hex digits from a repeated word, then a
 * four-digit index. `isEntry` enforces exactly 64 hex, and TxHistory links the
 * hash to a block explorer — where it will resolve to nothing, which is honest,
 * because this device did not sign it.
 */
const hash = (n: number) =>
  `0x${"facade".repeat(10)}${String(n).padStart(4, "0")}`;

/**
 * Six signatures, newest first: five confirmed and one reverted.
 *
 * TITLES ARE `renderIntent`'S OUTPUT, VERBATIM. `TxLogEntry.title` is documented
 * as the line PlanReview showed on the step, and PlanReview gets it from the
 * registry's `render` — so a row that phrased it differently would be a row no
 * real signature could have produced. Each of the six below is the template from
 * `intents/definitions.ts` for that kind, with its `detail` where the definition
 * has one.
 *
 * The reverted row is a repay, which is the failure a real user actually hits: the
 * loan closed between reading the page and signing, and the gas was still spent.
 * TxHistory dims the dot and adds a Reverted badge, and nothing else in the app
 * can produce that state before a deploy.
 */
const ENTRIES: TxLogEntry[] = [
  {
    hash: hash(1),
    kind: "swap",
    title: "Swap 0.35 WETH for USDC",
    detail: "Minimum received 1183.42 USDC at the set slippage.",
    status: "confirmed",
    at: AS_OF - 38 * MIN,
  },
  {
    hash: hash(2),
    kind: "repayLoan",
    title: "Repay 12500 USDC",
    detail: "Closes loan #874 in full, principal plus interest.",
    status: "reverted",
    at: AS_OF - 3 * HOUR,
  },
  {
    hash: hash(3),
    kind: "collectPoolFees",
    title: "Collect fees on KLD/USDC #4821",
    detail: "Pays out accrued fees. The position itself is untouched.",
    status: "confirmed",
    at: AS_OF - 11 * HOUR,
  },
  {
    hash: hash(4),
    kind: "mintStable",
    title: "Mint 5000 kfUSD",
    detail: "Backed 1:1 by 5000 USDC collateral.",
    status: "confirmed",
    at: AS_OF - 1 * DAY - 6 * HOUR,
  },
  {
    hash: hash(5),
    kind: "stake",
    title: "Stake 1200 KLD",
    detail: "Deposits into the KLD vault and mints liquid stKLD.",
    status: "confirmed",
    at: AS_OF - 4 * DAY,
  },
  {
    hash: hash(6),
    kind: "approve",
    title: "Approve USDC",
    detail:
      "Lets the contract move this token on your behalf. One-time per token.",
    status: "confirmed",
    at: AS_OF - 4 * DAY - 2 * MIN,
  },
];

/**
 * Cleared by the modal's Clear button, for this page load only.
 *
 * Clear is a real control with a real tooltip ("Delete this log from this
 * device"), and a button that visibly does nothing is exactly the kind of break
 * this whole flag exists to rule out. `clearTxLog` removes the storage key and
 * emits, the hook re-reads, and this flag is what makes the re-read come back
 * empty. Deliberately not persisted: a reload brings the rows back, which is how
 * you get to look at the empty state and then at the populated one without
 * editing anything.
 */
let cleared = false;

export function mockTxLogClear(): void {
  cleared = true;
}

/**
 * This device's log, for a connected wallet on a connected chain.
 *
 * Guarded on both, mirroring `readTxLog`: no chain and no address means no key to
 * read, and TxHistory's own "Connect a wallet to see what it has signed here."
 * must stay reachable.
 *
 * The rows do not vary by chain, and that is the one place this fixture is less
 * faithful than the thing it stands in for. A real log is keyed per chain, so
 * switching networks empties it — here the same six rows follow you across, which
 * makes the modal's "on <chain>" line an overstatement. Reproducing it properly
 * would mean inventing a plausible history per chain, and the alternative — rows
 * on one chain and an empty list on the rest — would leave the populated modal
 * reachable only on whichever chain was picked.
 */
export function mockTxLog(
  chainId: number | undefined,
  address: string | undefined,
): TxLogEntry[] {
  if (!chainId || !address || cleared) return [];
  return ENTRIES;
}
