/**
 * The one place a backend `action_type` becomes a UI category.
 *
 * The taxonomy was already on the wire before this file existed: every helper in
 * `src/utils/notificationService.ts` sends `metadata.action_type`, and the
 * WebSocket handler in NotificationsContext read it into a commented-out debug
 * log and then dropped it on the floor when it built the Notification. So the
 * categories here are not invented — they are the six values the backend already
 * sends, plus the three the agent flow needs.
 *
 * Centralised so no component ever switches on a raw string. A `switch` in a row
 * renderer and another in a filter drift the moment the backend adds a value;
 * one map means adding a value is a one-line edit with a compiler-checked home.
 */

import type { Intent } from "@/lib/v2/intents";

export type Category = "agent" | "orders" | "risk" | "system";

/**
 * Risk is deliberately not folded into orders.
 *
 * A liquidation and "your loan was filled" belong together only if urgency
 * doesn't matter. Burying a liquidation warning under routine order traffic is
 * the one failure this feature cannot have, so it gets its own tab and its own
 * delivery treatment.
 */
const BY_ACTION_TYPE: Record<string, Category> = {
  // Risk — time-sensitive, money-losing if missed.
  health_factor_warning: "risk",
  liquidation: "risk",

  // Orders — the loan lifecycle. Informational; you want them, they can wait.
  loan_created: "orders",
  loan_filled: "orders",
  new_borrow_request: "orders",
  loan_repaid: "orders",

  // Agent — Luca asking for something. The only category that can be actionable.
  permission_request: "agent",
  agent_action: "agent",
  plan_ready: "agent",
};

/**
 * Unknown and absent both fall to "system".
 *
 * This matters more than it looks: when the backend ships a new action_type,
 * the notification still appears in a real tab that a user actually visits,
 * rather than being filtered into nothing by a tab list that has never heard of
 * it. Silent disappearance is the failure mode; a slightly wrong tab is not.
 */
export function categorise(actionType?: string | null): Category {
  if (!actionType) return "system";
  return BY_ACTION_TYPE[actionType] ?? "system";
}

/** Pulls the action_type off a raw WebSocket / history payload. */
export function readActionType(data: {
  metadata?: { action_type?: string };
  action_type?: string;
}): string | undefined {
  return data?.metadata?.action_type ?? data?.action_type ?? undefined;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  agent: "Agent",
  orders: "Orders",
  risk: "Risk",
  system: "System",
};

/** Tab order in the panel. "All" is prepended by the component. */
export const CATEGORY_ORDER: Category[] = ["agent", "orders", "risk", "system"];

/**
 * A permission ask attached to a notification.
 *
 * Two kinds, and the difference decides what a button is allowed to claim:
 *
 *   "plan"  — signable. Cannot be approved headlessly because it needs the
 *             wallet, so the affordance says *Review* and opens PlanReview.
 *             Labelling it "Approve" and then demanding a signature would
 *             misdescribe what the click does.
 *   "limit" — an off-chain guardrail in useAgentSettings (a spend cap, an
 *             allowed action). No signature involved, so it genuinely resolves
 *             in place.
 */
export interface NotificationRequest {
  kind: "plan" | "limit";
  /** One line stating what is being asked for. */
  summary: string;
  /** kind:"plan" only — handed straight to PlanReview. */
  intents?: Intent[];
  /** kind:"limit" only — the guardrail the agent wants relaxed. */
  limit?: {
    field: "maxPerAction" | "maxPerDay";
    /** The value the agent is asking to be allowed, in USD. */
    requested: number;
  };
  status: "pending" | "approved" | "denied";
}
