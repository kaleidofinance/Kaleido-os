/**
 * What gets recorded in the notification panel for the user's own on-chain
 * activity, and for limit-order fills that happened while they were away.
 *
 * Pure, so both rules are pinned by activity.test.ts:
 *  - `describePlan` names a completed plan (swap, bridge, order placed or
 *    cancelled, anything else) from its intents and the steps that settled.
 *  - `newFills` diffs a maker's stored orders against what this browser last
 *    saw, so a fill is announced exactly once.
 */
import type { Intent } from "@/lib/v2/intents/types";

export type PlanSource = "agent" | "manual";

export interface SettledLike {
  title: string;
  skipped: boolean;
  hash?: string;
}

export interface PlanNotice {
  title: string;
  body: string;
  actionType: string;
}

const SWAP_KINDS = new Set([
  "swap",
  "swapMultiHop",
  "aggregatorSwap",
  "argusSwap",
  "wrapNative",
  "unwrapNative",
]);
const BRIDGE_KINDS = new Set(["bridge", "cctpReceive"]);

/** The headline action of a plan: the first intent that is not an approval. */
function mainKind(intents: readonly Intent[]): string | null {
  const k = intents.find((i) => i.kind !== "approve")?.kind;
  return k ?? null;
}

export function describePlan(
  intents: readonly Intent[],
  settled: readonly SettledLike[],
  source: PlanSource = "manual",
): PlanNotice | null {
  const kind = mainKind(intents);
  if (!kind) return null;

  let title: string;
  let actionType: string;
  if (kind === "placeOrder") {
    title = "Limit order placed";
    actionType = "order_placed";
  } else if (kind === "cancelOrder") {
    title = "Limit order cancelled";
    actionType = "order_cancelled";
  } else if (kind === "cancelAllOrders") {
    title = "Limit orders cancelled";
    actionType = "order_cancelled";
  } else if (BRIDGE_KINDS.has(kind)) {
    title = kind === "cctpReceive" ? "Bridge completed" : "Bridge sent";
    actionType = "bridge_executed";
  } else if (SWAP_KINDS.has(kind)) {
    title = "Swap confirmed";
    actionType = "trade_executed";
  } else {
    title = "Transaction confirmed";
    actionType = "trade_executed";
  }

  /* The step titles are what the plan card showed ("Swap 50 USDC → EURC");
     approvals and skipped steps are noise in a history row. */
  const steps = settled
    .filter((s) => !s.skipped && !/^approve\b/i.test(s.title))
    .map((s) => s.title);
  const body = steps.length > 0 ? steps.join(" · ") : title;

  if (source === "agent") {
    return { title: `Luca: ${title.toLowerCase()}`, body, actionType: "agent_action" };
  }
  return { title, body, actionType };
}

/** Per-order fill counts this browser has already announced. */
export type SeenFills = Record<string, number>;

export interface FillRow {
  hash: string;
  fills: number;
  tokenIn: string;
  tokenOut: string;
  interval: number;
}

/**
 * Orders whose fill count went up since `seen`, and the next `seen` to store.
 *
 * `seen === null` means this browser has no record for the wallet yet: the
 * current counts become the baseline and nothing is announced, so connecting
 * a wallet with old fills does not replay its history as fresh news.
 */
export function newFills(
  rows: readonly FillRow[],
  seen: SeenFills | null,
): { filled: FillRow[]; next: SeenFills } {
  const next: SeenFills = { ...(seen ?? {}) };
  const filled: FillRow[] = [];
  for (const r of rows) {
    const key = r.hash.toLowerCase();
    const before = seen ? (seen[key] ?? 0) : r.fills;
    if (r.fills > before) filled.push(r);
    next[key] = Math.max(r.fills, next[key] ?? 0);
  }
  return { filled, next };
}
