import { ClaudeProvider } from "./providers/claude";
import { OpenAIProvider } from "./providers/openai";
import type { ChatProvider } from "./types";

export { TOOL_CATALOG, EXECUTE_TOOLS } from "./toolCatalog";
export { isReadTool, runReadTool } from "./readTools";
export type {
  ChatInput,
  ChatMessage,
  ChatProvider,
  ChatResult,
  PlanStep,
  ToolSpec,
} from "./types";

/**
 * Provider selection.
 *
 * Set AI_PROVIDER to force one, or leave it unset and the first configured key
 * wins (Claude, then OpenAI). Model is overridable per provider so you can pin
 * a cheaper one without touching code. Adding a provider means one adapter file
 * and one branch here — nothing else in the app changes.
 *
 *   AI_PROVIDER=claude|openai   (optional)
 *   ANTHROPIC_API_KEY=...       ANTHROPIC_MODEL=claude-opus-5
 *   OPENAI_API_KEY=...          OPENAI_MODEL=gpt-5
 *
 * Keys are read server-side only — never NEXT_PUBLIC_, or they'd ship to the
 * browser in the client bundle.
 */
export function getProvider(): ChatProvider | null {
  const forced = process.env.AI_PROVIDER?.toLowerCase();
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (forced === "claude") {
    return anthropicKey
      ? new ClaudeProvider(anthropicKey, process.env.ANTHROPIC_MODEL)
      : null;
  }
  if (forced === "openai") {
    return openaiKey ? new OpenAIProvider(openaiKey, process.env.OPENAI_MODEL) : null;
  }

  if (anthropicKey) {
    return new ClaudeProvider(anthropicKey, process.env.ANTHROPIC_MODEL);
  }
  if (openaiKey) {
    return new OpenAIProvider(openaiKey, process.env.OPENAI_MODEL);
  }
  return null;
}

export interface Guardrails {
  maxPerAction?: number;
  maxPerDay?: number;
  minHealthFactor?: number;
  slippageBps?: number;
}

/**
 * Luca's system prompt. The user's own limits go in verbatim so the model
 * self-moderates — the on-chain permission facet still enforces them
 * independently, so this is guidance, not the security boundary.
 */
export function buildSystemPrompt(opts: {
  address?: string;
  chainId?: number;
  limits?: Guardrails;
}): string {
  const { address, chainId, limits } = opts;
  const lines = [
    "You are Luca, the agent inside Kaleido — a multichain DeFi operating system.",
    "",
    "You help users plan and execute strategies across lending, swaps, liquidity, staking and the kfUSD stablecoin, and you reason across protocols and chains when that serves the user better.",
    "",
    "How you work:",
    "- Call READ tools before proposing anything. Ground every number in a tool result; never estimate a rate, balance or health factor.",
    "- Call EXECUTE tools to build a plan. Each call becomes one signable step the user reviews before anything runs.",
    "- Order steps correctly: an approval must precede any step that spends a token the contract cannot yet move.",
    "- If a tool tells you data is not yet available, say so plainly. Never invent it.",
    "- Explain the tradeoff, not just the action: what it costs, what it forfeits, what it leaves unused.",
    "",
    "Safety:",
    "- Never propose a step that breaches the user's limits below.",
    "- Never propose anything that would push health factor toward liquidation.",
    "- The user signs every transaction. You propose; they approve.",
  ];

  if (address) lines.push("", `User wallet: ${address}`);
  if (chainId) lines.push(`Current chain ID: ${chainId}`);

  if (limits) {
    lines.push("", "User's limits:");
    if (limits.maxPerAction !== undefined)
      lines.push(`- Max $${limits.maxPerAction} per action`);
    if (limits.maxPerDay !== undefined)
      lines.push(`- Max $${limits.maxPerDay} per day`);
    if (limits.minHealthFactor !== undefined)
      lines.push(`- Keep health factor at or above ${limits.minHealthFactor}`);
    if (limits.slippageBps !== undefined)
      lines.push(`- Max slippage ${(limits.slippageBps / 100).toFixed(2)}%`);
  }

  return lines.join("\n");
}
