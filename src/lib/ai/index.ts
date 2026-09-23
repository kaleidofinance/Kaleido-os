import { ClaudeProvider } from "./providers/claude";
import { OpenAIProvider } from "./providers/openai";
import { getContracts } from "@/constants/registry";
import type { ChatProvider } from "./types";

export { TOOL_CATALOG, EXECUTE_TOOLS } from "./toolCatalog";
export { isReadTool, runReadTool } from "./readTools";
export {
  canUseBrowserLocalModel,
  browserLocalIntentOptions,
  DEFAULT_BROWSER_LOCAL_INTENT_MODEL,
  validateLocalClassification,
} from "./localIntent";
export type {
  BrowserLocalIntentModel,
  LocalIntentClassification,
  LocalIntentContext,
  LocalTurnKind,
} from "./localIntent";
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

/**
 * Gemini (Google AI Studio), reached through Google's OpenAI-compatible endpoint
 * — so it runs on the existing OpenAIProvider, no new adapter. Sits ALONGSIDE the
 * AgentRouter family: a selectable model id maps to its own gateway + wire format
 * exactly as the router ids do.
 *
 * Entitlement is per key AND per billing tier, the same 403/429-not-404 trap the
 * AgentRouter note describes: on a free key the `pro` ids are recognised but
 * quota-gated (429), while `gemini-flash-latest` answers and still reasons
 * (its usage reports internal thinking tokens). `-latest` tracks Google's current
 * recommended model, which is why 2.5-pro's "no longer available to new users"
 * retirement does not strand this list. Verified against GET /v1beta/models and a
 * live /chat/completions on 2026-09-12.
 */
export const GEMINI_MODELS = {
  "gemini-flash-latest": { label: "Gemini Flash" },
  "gemini-3.1-pro-preview": { label: "Gemini 3.1 Pro" },
} as const satisfies Record<string, { label: string }>;

export type GeminiModel = keyof typeof GEMINI_MODELS;

export const isGeminiModel = (id: string): id is GeminiModel =>
  Object.hasOwn(GEMINI_MODELS, id);

export const GEMINI_MODEL_IDS = Object.keys(GEMINI_MODELS) as GeminiModel[];

/** Any model id the chat route will accept from a client — the router family
    plus the Gemini family, whichever keys are configured. */
/**
 * Vercel AI Gateway — one key over an OpenAI-compatible endpoint that fans out to
 * every major provider, so it too rides the existing OpenAIProvider. Same family
 * shape as the router and Gemini catalogues. Model ids are `provider/model`.
 *
 * Tiered like Gemini: on a free Gateway key the premium routes (Anthropic, some
 * Google) 403 "upgrade to paid credits", while OpenAI's GPT-5 line and DeepSeek
 * R1 answer 200 — so the catalogue is the confirmed free-tier reasoning set. The
 * default is openai/gpt-5-MINI, not gpt-5: the full reasoning model measured
 * ~50s/call against the gateway (2026-09-17), which overruns the 60s serverless
 * limit on any two-round turn — a strategy question timed out as
 * FUNCTION_INVOCATION_TIMEOUT, surfaced to the user as a provider error. Mini
 * answers the same turn in ~20s. Verified live 2026-09-12; add a row only after a
 * 200 from /chat/completions, not from the 376-long /models list (a listed id you
 * lack 403s, not 404s — the same trap as the AgentRouter note above).
 */
export const GATEWAY_MODELS = {
  "openai/gpt-5": { label: "GPT-5 · Gateway" },
  "openai/o3": { label: "o3 · Gateway" },
  "openai/gpt-5-mini": { label: "GPT-5 Mini · Gateway" },
  "deepseek/deepseek-r1": { label: "DeepSeek R1 · Gateway" },
} as const satisfies Record<string, { label: string }>;

export type GatewayModel = keyof typeof GATEWAY_MODELS;

export const isGatewayModel = (id: string): id is GatewayModel =>
  Object.hasOwn(GATEWAY_MODELS, id);

export const GATEWAY_MODEL_IDS = Object.keys(GATEWAY_MODELS) as GatewayModel[];

export const isSelectableModel = (id: string): boolean =>
  isRouterModel(id) || isGeminiModel(id) || isGatewayModel(id);

/* Provider builders, one per configured backend. Module-level so both
   getProvider (which picks one) and getProviderChain (which orders them for
   failover) share a single definition — the base URL, cap and UA each key
   implies live with the key, not duplicated across call sites. Each returns null
   when its key is unset. */
const buildAgentRouter = (id?: string): ChatProvider | null =>
  process.env.AGENTROUTER_API_KEY
    ? new ClaudeProvider(
        process.env.AGENTROUTER_API_KEY,
        id || process.env.AGENTROUTER_MODEL || "claude-opus-5",
        {
          baseUrl: process.env.AGENTROUTER_BASE_URL || "https://agentrouter.org",
          id: "agentrouter",
          maxTokens: 8192,
          userAgent: process.env.AGENTROUTER_USER_AGENT,
        },
      )
    : null;

const buildAgentRouterOpenAi = (id?: string): ChatProvider | null =>
  process.env.AGENTROUTER_API_KEY
    ? new OpenAIProvider(
        process.env.AGENTROUTER_API_KEY,
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

const buildClaude = (): ChatProvider | null =>
  process.env.ANTHROPIC_API_KEY
    ? new ClaudeProvider(
        process.env.ANTHROPIC_API_KEY,
        process.env.ANTHROPIC_MODEL,
      )
    : null;

const buildOpenAi = (): ChatProvider | null => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const baseUrl = process.env.OPENAI_BASE_URL;
  const cap = Number(process.env.OPENAI_MAX_TOKENS);
  return new OpenAIProvider(key, process.env.OPENAI_MODEL, {
    ...(baseUrl ? { baseUrl, id: "openai-compatible" } : {}),
    ...(Number.isFinite(cap) && cap > 0 ? { maxTokens: cap } : {}),
    ...(process.env.OPENAI_USER_AGENT
      ? { userAgent: process.env.OPENAI_USER_AGENT }
      : {}),
  });
};

/* Gemini + Gateway: maxTokens unset on purpose — their reasoning models spend
   internal thinking tokens against the completion budget, so a low cap would
   truncate the reasoning they are chosen for. */
const buildGemini = (id?: string): ChatProvider | null =>
  process.env.GEMINI_API_KEY
    ? new OpenAIProvider(
        process.env.GEMINI_API_KEY,
        id || process.env.GEMINI_MODEL || "gemini-flash-latest",
        {
          baseUrl:
            process.env.GEMINI_BASE_URL ||
            "https://generativelanguage.googleapis.com/v1beta/openai",
          id: "gemini",
        },
      )
    : null;

const buildGateway = (id?: string): ChatProvider | null =>
  process.env.AI_GATEWAY_API_KEY
    ? new OpenAIProvider(
        process.env.AI_GATEWAY_API_KEY,
        id || process.env.AI_GATEWAY_MODEL || "openai/gpt-5-mini",
        {
          baseUrl:
            process.env.AI_GATEWAY_BASE_URL ||
            "https://ai-gateway.vercel.sh/v1",
          id: "ai-gateway",
        },
      )
    : null;

export function getProvider(model?: string): ChatProvider | null {
  const forced = process.env.AI_PROVIDER?.toLowerCase();
  const routerKey = process.env.AGENTROUTER_API_KEY;

  /* A recognised model id wins over AI_PROVIDER: it names both the gateway and
     the wire format, which is what AI_PROVIDER could only approximate. Each is
     guarded on its own key — without it the hint is ignored and precedence
     answers, rather than returning a provider the caller is not entitled to. */
  if (routerKey && model && isRouterModel(model)) {
    return ROUTER_MODELS[model].api === "openai"
      ? buildAgentRouterOpenAi(model)
      : buildAgentRouter(model);
  }
  if (process.env.GEMINI_API_KEY && model && isGeminiModel(model)) {
    return buildGemini(model);
  }
  if (process.env.AI_GATEWAY_API_KEY && model && isGatewayModel(model)) {
    return buildGateway(model);
  }

  if (forced === "agentrouter") return buildAgentRouter();
  if (forced === "agentrouter-openai") return buildAgentRouterOpenAi();
  if (forced === "claude") return buildClaude();
  if (forced === "openai") return buildOpenAi();
  if (forced === "gemini") return buildGemini();
  if (forced === "gateway" || forced === "ai-gateway") return buildGateway();

  /* Precedence when nothing is forced: first configured key wins. */
  if (routerKey) return buildAgentRouter();
  return buildClaude() ?? buildOpenAi() ?? buildGemini() ?? buildGateway();
}

/**
 * The provider to use, then the ones to fall back to if it errors — so a model
 * outage degrades to the next backend instead of taking the agent down (the run
 * loop applies the failover). The primary is getProvider's pick (honouring a
 * model id / AI_PROVIDER / precedence); the rest are every OTHER configured
 * provider, de-duped by reported id. That the same request is retried against a
 * different backend is safe because the model never sets addresses or amounts —
 * the deterministic builder does, downstream of this.
 */
export function getProviderChain(model?: string): ChatProvider[] {
  const primary = getProvider(model);
  if (!primary) return [];
  const chain: ChatProvider[] = [primary];
  const seen = new Set<string>([primary.id]);
  for (const build of [
    buildGateway,
    buildGemini,
    buildAgentRouter,
    buildClaude,
    buildOpenAi,
  ]) {
    const p = build();
    if (p && !seen.has(p.id)) {
      chain.push(p);
      seen.add(p.id);
    }
  }
  return chain;
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
    "- Don't reassure or narrate the routine. No \"this is safe\", \"one-time\", \"reversible any time\", \"no approval needed\", \"the floor is enforced on-chain\". State the action and its numbers; the user knows what a swap or an approval is. Name a caution only when there is a real one.",
    "- Never mention your own machinery. No tool names, no 'tool call', 'read', 'round', 'context', 'query', 'indexer', 'client-side', 'reasoning engine', or 'the data I got back'. The user asked about their money, not how you looked it up.",
    "- Never refer to the interface as something the user should go operate — you are the interface.",
    '- Name a network, never its id: "on Sepolia", not "chain 11155111". Same for a token — its symbol, never its address.',
    "- Structure only where it earns its place, and prose is still the default — a two-sentence answer needs none of it. Bold the one figure or term the answer turns on, not whole clauses. A short list for genuinely parallel items, one line each and never nested. At most one short heading, and only when the answer has distinct parts a reader will scan between. Markdown renders, so these read as written — which is also why a wall of bold or a heading over two sentences reads as noise.",
    "- Use cards as part of the answer, never as a replacement for context. When the answer includes figures — balances, pool rankings, liquidity, volume, rates or health — explain the result in one or two useful sentences, then add a `cards` block with the scannable values. The card replaces a wall of digits, not the meaning of those digits.",
    "- Ask at most one question, at the end, and only when you cannot proceed without the answer.",
    "",
    /* "How you write" governs the answer, and the model reads it that way — so
       the lines it writes on the way to the answer came back untouched by it: 316
       characters of narration that named a chain by its id and pointed the user
       at "that view", both of which the section above forbids. They sit behind a
       fold, so the stakes are lower, but a fold the user can open is still the
       user's screen.

       The frame is what makes the rule obvious rather than arbitrary: page.tsx
       renders these as an <ol> under a "How I answered" summary, so each line is
       a list-item label. A clause fits that shape; a paragraph does not. The bound
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
    /* The reasoning channel. One distilled line — the single fact or tradeoff
       that decided the answer — lifted into the folded record, never the prose.
       Separate from the per-round preamble above: that says what a round is
       checking, this says why the turn landed where it did, and a turn with no
       reads (a judgement call answered outright) has one and not the other.

       Bounded and optional on purpose. The "How you write" section fought hard to
       stop Luca narrating, and this must not reopen that: it is a clause behind a
       fold, capped in splitReasoning at MAX_REASONING_CHARS, stripped from the
       answer by the same fence discipline as the two blocks below, and explicitly
       omitted whenever the "why" is self-evident — which is most turns. It earns
       its place only when a real decision was made and the user might want to see
       the reason behind it. See src/lib/ai/actionsBlock.ts for the parser. */
    "Showing your reasoning:",
    "- When a real decision drove your answer or plan — a tradeoff you weighed, the one fact that settled it — you may end the reply with that reason in a fenced block, and write nothing after it:",
    "```reasoning",
    "Chose the 0.05% pool over the 0.30% — tighter price at this size, and the fee saved beats the extra hop.",
    "```",
    "- One clause, under 140 characters, naming only the deciding reason. It goes in the folded record the user can open, never in the answer — so do not repeat the answer, restate the plan, or put an action in it.",
    "- Omit it entirely for a plain factual answer, a greeting, or anything where the reason is obvious. A reasoning line under every reply is the narration the rules above forbid, wearing a different hat.",
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
    /* The display-card channel. Same literal-fence discipline as the actions
       block above, and the same gate after it: cardsFromChat validates, caps and
       rebuilds every card, so this guidance is about USING it well, not about
       what is allowed. The shapes are quoted because a near-miss renders nothing.
       See src/lib/ai/actionsBlock.ts (parser) and src/lib/v2/cards/types.ts. */
    "Showing data as a card:",
    "- When your answer has numbers the user will scan — one figure, a few related figures, token balances, a health reading, or live pool rankings — present them as cards alongside the explanation. End the reply with this block after the necessary prose (an actions block, if you add one, comes after it):",
    "```cards",
    '[{"kind": "metric", "label": "Health factor", "value": "1.62"}]',
    "```",
    "- A JSON array, at most 3 cards. Every value is a STRING you have already formatted (\"1,240.55\", not 1240.55) — the frame does not format. Use only figures you actually read this turn; never invent one for a card, and never restate in a card a single number the prose already gave.",
    "- The kinds and their shapes:",
    '  - metric — one figure: {"kind":"metric","label","value","unit"?,"note"?}',
    '  - stats — a label/value column: {"kind":"stats","title"?,"rows":[{"label","value","tone"?}]}. tone is "good" | "warn" | "bad" and tints the value.',
    '  - balance — token amounts: {"kind":"balance","title"?,"rows":[{"symbol","amount","note"?}]}. The symbol draws the token logo.',
    '  - gauge — a reading on a track: {"kind":"gauge","label","value","fraction","tone","min"?,"max"?,"note"?}. fraction is 0..1, how full to draw the bar; tone colours it; you map the number onto both (a health factor of 1.6 is roughly 0.3 and "warn").',
    '  - notice — a statement to see first: {"kind":"notice","tone","title","body"?}. For the one caution the prose is about.',
    '  - For getLivePools or getPoolMarket, prefer one stats card titled "Live pools" with rows such as "USDC/WETH · 0.3%" → "$12,400 liquidity" or "24h volume" → "$3,100". Keep the pair and fee in the row label, and only use values returned by the tool.',
    "",
    "Safety:",
    "- Never propose a step that breaches the user's limits below.",
    "- Never propose anything that would push health factor toward liquidation.",
    "- The user signs every transaction. You propose; they approve.",
  ];

  if (address) lines.push("", `User wallet: ${address}`);
  if (chainId) lines.push(`Current chain ID: ${chainId}`);

  /* What this chain does NOT have, so the model does not propose it. The app
     defaults to Arc mainnet, which is DEX-first: swaps (through the aggregator),
     wrapping USDC and bridging work, but the lending diamond, KLD, staking and the
     kfUSD stablecoin are not deployed there. Derived from the registry, not
     hardcoded, so a chain gains a capability the moment it is deployed — and the
     testnets, which have all of it, add no restriction. Fail-open: a registry that
     cannot answer for a chain simply imposes no limit. */
  if (chainId !== undefined) {
    try {
      const c = getContracts(chainId);
      const absent: string[] = [];
      if (!c.diamond) absent.push("peer-to-peer lending, borrowing and collateral");
      if (!c.kldVault) absent.push("KLD staking");
      if (!c.kfUSD) absent.push("the kfUSD / kafUSD stablecoin");
      if (!c.kld) absent.push("KLD (do not offer to trade or stake it)");
      if (absent.length) {
        lines.push(
          "",
          `Not on the user's current chain — never propose these, and say plainly they aren't available here if asked: ${absent.join("; ")}. What works here: swaps, wrapping USDC, bridging, and reading the wallet.`,
        );
      }
    } catch {
      /* No registry entry for the chain — impose no capability restriction. */
    }
  }

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
