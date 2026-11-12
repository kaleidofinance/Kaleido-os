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
  /** Client routing hint: dynamic protocol questions must use live reads. */
  analysisMode?: unknown;
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
  const liveAnalysis = body.analysisMode === "live";
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
      ...(liveAnalysis
        ? [
            "This is a live protocol-analysis turn. Use fresh chain/provider reads before answering; do not answer from FAQ, docs, product copy, or remembered rates. If the requested live source is not configured or a read fails, say that explicitly with the chain and scope instead of inventing a yield, venue, or capability.",
            "For lending or yield questions, call getYieldSources first. It combines the live lending registration, fixed-APR offers, and pool APR snapshots. Use getLendingAssets or getMarkets for drill-down, and do not describe an asset as lendable from the general token registry alone.",
            "For external protocol, venue, aggregator, or cross-market questions, call getExternalPools first when a curated inventory is relevant. Treat it as dated research evidence only: it is not Kaleido TVL, a live quote, or permission to execute. Request a fresh reviewed aggregator quote before describing a route as executable.",
            "For questions about what Kaleido supports, which launchpads or aggregators are integrated, or whether a product is available on a chain, call getProtocolCapabilities first. It reports configured operation surfaces only; follow it with the relevant live read or quote for pair- or route-specific availability.",
            "For analytics, revenue, volume, fees, swaps, bridges, or protocol activity questions, call getAnalytics first. Use scope=all for a whole-protocol question and targetChain for a named chain. Its trading totals include native and approved aggregator-routed activity; its accounting field defines what is excluded. Never reconstruct revenue from pool rows or treat a partial ledger as complete.",
          ]
        : []),
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
    ...(liveAnalysis ? { analysisMode: "live" as const } : {}),
  };
}
