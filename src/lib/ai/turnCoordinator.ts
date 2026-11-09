import type { AgentInput } from "./agent";
import { validateLocalClassification } from "./localIntent";
import { productFacts } from "./normalizer";
import { sanitizeGuardrails } from "./auditor";
import { walletChainContext } from "./walletContext";
import type { CapabilitySnapshot } from "./capabilities";
import type { TurnContext } from "./turnContext";
import type { ChatMessage } from "./types";

const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS = 2_000;

export interface TurnRequestBody {
  message?: unknown;
  limits?: unknown;
  localIntent?: unknown;
  history?: unknown;
  grounding?: unknown;
}

export function historyFromBody(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const clean: ChatMessage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const text = content.trim().slice(0, MAX_HISTORY_CHARS);
    if (!text) continue;
    clean.push({ role, content: text });
  }
  return clean.slice(-MAX_HISTORY_MESSAGES);
}

export function groundingFromBody(raw: unknown): AgentInput["grounding"] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<AgentInput["grounding"]> = [];
  for (const g of raw.slice(0, 3)) {
    if (!g || typeof g !== "object") continue;
    const { title, heading, href, text } = g as Record<string, unknown>;
    if (
      typeof title !== "string" ||
      typeof text !== "string" ||
      typeof href !== "string"
    )
      continue;
    if (!/^\/docs\/[a-z0-9-]+(#[a-z0-9-]+)?$/.test(href)) continue;
    out.push({
      title: title.slice(0, 80),
      heading: typeof heading === "string" ? heading.slice(0, 80) : "",
      href,
      text: text.slice(0, 900),
    });
  }
  return out.length ? out : undefined;
}

/** Assemble one provider-neutral input from the validated turn scope. */
export function createAgentInput(
  body: TurnRequestBody,
  context: TurnContext,
  capabilities: CapabilitySnapshot,
): AgentInput {
  const localIntent = validateLocalClassification(body.localIntent);
  return {
    message: String(body.message ?? ""),
    context,
    address: context.address,
    chainId: context.chainId,
    requestId: context.requestId,
    capabilities,
    limits: sanitizeGuardrails(body.limits),
    history: historyFromBody(body.history),
    grounding: groundingFromBody(body.grounding),
    systemAddendum: [
      productFacts(context.mainnetOnly),
      walletChainContext(context.chainId),
      "For current balances, prices, quotes, liquidity, supported chains, protocol activity, revenue, lending rates, or portfolio analysis, call the relevant live read tools before stating facts. Docs and product descriptions are background only; fresh tool results take precedence. Choose tools relevant to the question, preserve any named chain scope, and never read lending positions merely because a wallet is connected. Ask independent reads together. Answer stable conceptual questions directly and concisely. Propose transactions only when the user requests an action; questions mentioning a trade or loan are not transaction instructions.",
      ...(localIntent.kind !== "unknown"
        ? [
            "A browser-local classifier supplied a non-authoritative context hint. Treat it only as a tie-breaker for conversation reference; verify the user's words and history yourself. Never use it for transaction arguments.",
            `Local hint: kind=${localIntent.kind}; reference=${localIntent.reference ?? "none"}.`,
          ]
        : []),
    ].join("\n"),
    mainnetOnly: context.mainnetOnly,
    networkMode: context.networkMode,
  };
}
