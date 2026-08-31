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
  ExecuteCall,
  PlanStep,
  ReadCall,
  ToolSpec,
} from "./types";

/**
 * Provider selection.
 *
 * Set AI_PROVIDER to force one, or leave it unset and the first configured key
 * wins (AgentRouter, then Claude, then OpenAI). Model is overridable per
 * provider so you can pin a cheaper one without touching code. Adding a
 * provider means one adapter file and one branch here — nothing else in the app
 * changes.
 *
 *   AI_PROVIDER=agentrouter|agentrouter-openai|claude|openai   (optional)
 *   AGENTROUTER_API_KEY=...     AGENTROUTER_MODEL=claude-opus-4-8
 *                               AGENTROUTER_OPENAI_MODEL=gpt-5.6-sol
 *                               AGENTROUTER_USER_AGENT=...   (required, see .env)
 *   ANTHROPIC_API_KEY=...       ANTHROPIC_MODEL=claude-opus-5
 *   OPENAI_API_KEY=...          OPENAI_MODEL=gpt-5
 *                               OPENAI_BASE_URL=...  (any compatible gateway)
 *
 * AgentRouter is checked first because configuring it is an explicit act: the
 * two direct providers are the defaults you get from having a vendor account
 * lying around, so a router key present in the environment is the stronger
 * signal about intent. The bare `agentrouter` fall-through picks the Messages
 * path; reach the OpenAI one by naming it in AI_PROVIDER, since a key alone
 * cannot say which of a router's two formats you meant.
 *
 * The Messages branch reuses ClaudeProvider rather than adding an adapter,
 * because AgentRouter declares `api: "anthropic-messages"` — same wire format,
 * different origin. "OpenAI-compatible" describes the router's catalogue, not
 * that one endpoint's body shape; the two are not interchangeable, which is why
 * each path has its own branch and its own adapter.
 *
 * Keys are read server-side only — never NEXT_PUBLIC_, or they'd ship to the
 * browser in the client bundle.
 */
/**
 * The router's catalogue, keyed by the exact id its API expects.
 *
 * The id decides the wire format, so it decides the adapter — claude-* speaks
 * Messages (system + input_schema), gpt-* speaks Chat Completions (messages[] +
 * tools[].function), and the two bodies are not interchangeable. Encoding that
 * here means a caller names a model and gets the right adapter, instead of
 * setting AI_PROVIDER to match and getting a 400 when the two disagree.
 *
 * Verified against GET /v1/models on 2026-08-10 — these are exactly the three
 * this token is entitled to. Entitlement is per-token and the failure is a 403
 * "该令牌无权访问模型 <id>", not a 404, so an id you lack and an id that does not
 * exist look identical. Re-run that endpoint before adding a row here rather
 * than trusting a docs page or a pasted config; `gpt-5.5` arrived by that route
 * and is not on this account.
 */
export const ROUTER_MODELS = {
  "claude-opus-5": { api: "messages", label: "Claude Opus 5" },
  "claude-opus-4-8": { api: "messages", label: "Claude Opus 4.8" },
  "gpt-5.6-sol": { api: "openai", label: "GPT-5.6 Sol" },
} as const satisfies Record<
  string,
  { api: "messages" | "openai"; label: string }
>;

export type RouterModel = keyof typeof ROUTER_MODELS;

export const isRouterModel = (id: string): id is RouterModel =>
  Object.hasOwn(ROUTER_MODELS, id);

/** Ordered for a picker: cheapest-to-strongest is not knowable here, so this is
    catalogue order — Messages models first, since that is the default path. */
export const ROUTER_MODEL_IDS = Object.keys(ROUTER_MODELS) as RouterModel[];

export function getProvider(model?: string): ChatProvider | null {
  const forced = process.env.AI_PROVIDER?.toLowerCase();
  const routerKey = process.env.AGENTROUTER_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  /* Built here rather than inline in three places so the base URL and the
     8192 cap stay together with the key that requires them. The cap is the
     router's declared maxTokens — asking for the adapter's default 4096 is
     safe, but asking for more than a gateway allows is a 400 on every turn. */
  const agentRouter = (id?: string) =>
    routerKey
      ? new ClaudeProvider(
          routerKey,
          id || process.env.AGENTROUTER_MODEL || "claude-opus-5",
          {
            baseUrl:
              process.env.AGENTROUTER_BASE_URL || "https://agentrouter.org",
            id: "agentrouter",
            maxTokens: 8192,
            userAgent: process.env.AGENTROUTER_USER_AGENT,
          },
        )
      : null;

  /* The same router and the same key, its OpenAI-shaped path. A separate
     adapter rather than a flag because the request bodies differ entirely;
     see ROUTER_MODELS above for why the model id is what selects between
     them. */
  const agentRouterOpenAi = (id?: string) =>
    routerKey
      ? new OpenAIProvider(
          routerKey,
          id || process.env.AGENTROUTER_OPENAI_MODEL || "gpt-5.6-sol",
          {
            baseUrl:
              process.env.AGENTROUTER_OPENAI_BASE_URL ||
              "https://agentrouter.org/v1",
            id: "agentrouter-openai",
            maxTokens: 8192,
            userAgent: process.env.AGENTROUTER_USER_AGENT,
          },
        )
      : null;

  /* Same reason as agentRouter above: the base URL, the cap and the key that
     implies them stay in one place instead of being duplicated across the
     forced and fall-through branches. A custom base URL renames the reported
     provider, so a log line names the gateway that actually answered rather
     than claiming OpenAI served it. */
  const openAi = () => {
    if (!openaiKey) return null;
    const baseUrl = process.env.OPENAI_BASE_URL;
    const cap = Number(process.env.OPENAI_MAX_TOKENS);
    return new OpenAIProvider(openaiKey, process.env.OPENAI_MODEL, {
      ...(baseUrl ? { baseUrl, id: "openai-compatible" } : {}),
      ...(Number.isFinite(cap) && cap > 0 ? { maxTokens: cap } : {}),
      ...(process.env.OPENAI_USER_AGENT
        ? { userAgent: process.env.OPENAI_USER_AGENT }
        : {}),
    });
  };

  /* A recognised router model id wins over AI_PROVIDER, because it is strictly
     more specific: it names both the gateway and the wire format, which is the
     thing AI_PROVIDER could only approximate. Unrecognised ids fall through to
     the env-configured provider rather than being forwarded — the router 403s
     an id the token lacks, and silently passing one on would spend a request to
     learn that. Requires the router key; without it a caller asking for
     claude-opus-5 is not entitled to it, so ignore the hint entirely. */
  if (routerKey && model && isRouterModel(model)) {
    return ROUTER_MODELS[model].api === "openai"
      ? agentRouterOpenAi(model)
      : agentRouter(model);
  }

  if (forced === "agentrouter") return agentRouter();
  if (forced === "agentrouter-openai") return agentRouterOpenAi();
  if (forced === "claude") {
    return anthropicKey
      ? new ClaudeProvider(anthropicKey, process.env.ANTHROPIC_MODEL)
      : null;
  }
  if (forced === "openai") return openAi();

  if (routerKey) return agentRouter();
  if (anthropicKey) {
    return new ClaudeProvider(anthropicKey, process.env.ANTHROPIC_MODEL);
  }
  if (openaiKey) {
    return openAi();
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
