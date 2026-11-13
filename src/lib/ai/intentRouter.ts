export type IntentRoute =
  | "deterministic_command"
  | "live_read"
  | "protocol_catalog"
  | "conversation"
  | "reasoning";

export interface IntentDecision {
  route: IntentRoute;
  confidence: number;
  authoritative: boolean;
}

const ACTION = /\b(?:swap|bridge|send|buy|sell|lend|borrow|repay|deposit|withdraw|stake|unstake|add|remove|collect|claim|mint|redeem|create|deploy|launch)\b/i;
const LIVE = /\b(?:balance|balances|price|quote|route|pool|pools|tvl|volume|fees|position|positions|portfolio|holdings|markets?|liquidity|apr|apy|live|current|now|status)\b/i;
const CATALOG = /\b(?:launch\s*pad|aggregator|integrat(?:ed|ion|ions)|supported|which\s+chains|how\s+many\s+chains)\b/i;
const REASONING = /\b(?:compare|best|why|should|recommend|strategy|analy[sz]e|plan|opportunity|yield|risk)\b/i;

/**
 * Fast routing is a hint, never an answer. In particular, a local parser or
 * FAQ must not swallow ordinary conversation just because it spots one keyword.
 */
export function routeIntent(message: string): IntentDecision {
  const text = message.trim();
  if (!text) return { route: "conversation", confidence: 1, authoritative: false };
  if (ACTION.test(text)) {
    return { route: "deterministic_command", confidence: 0.92, authoritative: true };
  }
  if (CATALOG.test(text)) {
    return { route: "protocol_catalog", confidence: 0.84, authoritative: false };
  }
  if (LIVE.test(text)) {
    return { route: "live_read", confidence: 0.8, authoritative: false };
  }
  if (REASONING.test(text)) {
    return { route: "reasoning", confidence: 0.74, authoritative: false };
  }
  return { route: "conversation", confidence: 0.62, authoritative: false };
}

export function canUseLocalCatalog(message: string): boolean {
  return routeIntent(message).route === "protocol_catalog";
}
