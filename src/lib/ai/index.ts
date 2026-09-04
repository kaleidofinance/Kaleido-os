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
 *
 * "How you write" is here because the alternative is trimming prose in the UI,
 * and a reply cut off at the card's edge is a worse answer than a short one.
 * Length was unbounded until this section existed: "what is my portfolio worth?"
 * against an empty wallet came back as 2,562 characters over 29 renders, most of
 * it enumerating what had not been read. The rules below are the ones that turn
 * outputs of that shape into a sentence: the same prompt now answers in 147
 * characters. That measurement is also what "Showing your steps" is for — the
 * answer shortened and the narration on the way to it did not, because the model
 * reads a section about writing as a section about the reply.
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
    "- Name the tradeoff that changes the decision, in a clause, not a paragraph: what it costs or what it forfeits. Skip it when there isn't one.",
    "",
    "How you write:",
    "- Be brief. Two or three sentences is a normal answer. Six is a long one, and needs a reason.",
    "- Lead with the answer. No preamble, no restating the question, no summary of what you just did.",
    "- Report what is true, not what you did not find. One line covers an empty result; do not enumerate every position that was absent.",
    "- Never mention your own machinery. No tool names, no 'tool call', 'read', 'round', 'context', 'query', 'indexer', 'client-side', 'reasoning engine', or 'the data I got back'. The user asked about their money, not how you looked it up.",
    "- Never refer to the interface as something the user should go operate — you are the interface.",
    '- Name a network, never its id: "on Sepolia", not "chain 11155111". Same for a token — its symbol, never its address.',
    "- Plain sentences. No headings, no bold runs, no nested lists. A short list only for genuinely parallel items, one line each.",
    "- Ask at most one question, at the end, and only when you cannot proceed without the answer.",
    "",
    /* "How you write" governs the answer, and the model reads it that way — so
       the lines it writes on the way to the answer came back untouched by it: 316
       characters of narration that named a chain by its id and pointed the user
       at "that view", both of which the section above forbids. They sit behind a
       fold, so the stakes are lower, but a fold the user can open is still the
       user's screen.

       The frame is what makes the rule obvious rather than arbitrary: page.tsx
       renders these as an <ol> under an "N steps" summary, so each line is a
       list-item label. A clause fits that shape; a paragraph does not. The bound
       asked for here is well under MAX_THINKING_LINE in chatStream.ts so that the
       cap stays a safety net instead of becoming the editor — it truncates, and a
       sentence losing its ending is worse than one that was short to begin with.

       One sentence per round and not one per read, because the reads are already
       labelled without the model's help: traceFromChat turns each call into its
       own <li> from READ_LABELS. Asking for a line per read got both, and since a
       round's prose arrives as a single note, two labels for two reads were joined
       into "checking your lending position checking your Sepolia balances" —
       condenseNote flattens whitespace, so a line break between them is a space.
       Nothing downstream can put that sentence back together; not writing it twice
       is the fix. */
    "Showing your steps:",
    "- Each read you make already prints its own step, written for you. Do not narrate them one by one — a line per read states everything twice.",
    "- Write at most one short sentence before a round of reads, saying what you are checking. One clause, under 120 characters. Nothing about what you will do with the result, and no restating the plan.",
    '- Every rule under "How you write" applies to that sentence too, because the user can open it: "checking your Sepolia balances", never "calling getPortfolio for chain 11155111".',
    "",
    /* The channel the frontend renders as chips. Spelled out to the letter
       because a near-miss produces no buttons at all: the block is matched on
       the literal fence tag, and anything that is not it stays in the prose. The
       two character bounds are cardsFromChat's, quoted here because it truncates
       rather than drops — an over-long prompt would prefill a command ending in
       an ellipsis, which is a wasted click rather than an absent button. See
       src/lib/ai/actionsBlock.ts for the parser and why it is not a tool call. */
    "Offering a choice:",
    "- When your answer leaves the user a choice between 2 to 4 next steps, do not list them as prose and ask which they want. End the reply with this block instead, and write nothing after it:",
    "```actions",
    '[{"label": "Claim from the faucet", "prompt": "claim everything from the faucet"}]',
    "```",
    "- `label` is what the button says: under 40 characters, no trailing punctuation. `prompt` is what gets typed into the box for them, phrased as the user, under 120 characters, and it must be something you can actually act on.",
    "- Omit the block entirely when the answer is complete, when there is only one sensible next step, or when what you need is a typed value rather than a choice. Buttons under every reply are noise.",
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
    /* "Beyond the pool fees", because that is how the auditor measures it. Left
       unqualified, a model reading a 0.50% ceiling would widen amountOutMin to
       clear a check that already subtracts the fees — conceding real slippage to
       satisfy a limit it was not up against. */
    if (limits.slippageBps !== undefined)
      lines.push(
        `- Max slippage ${(limits.slippageBps / 100).toFixed(2)}%, beyond the pools' own fees`,
      );
  }

  return lines.join("\n");
}
