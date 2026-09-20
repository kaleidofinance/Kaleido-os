import { experimental_evaluate as evaluate } from "ai";

export type JevRoute =
  | "transaction_plan"
  | "read_only"
  | "faq"
  | "clarification"
  | "full_reasoning";

export type JevRouteResult = {
  route: JevRoute;
  confidence: number | null;
  probabilities: Record<string, number> | null;
};

const JEV_ROUTES: readonly JevRoute[] = [
  "transaction_plan",
  "read_only",
  "faq",
  "clarification",
  "full_reasoning",
];

/**
 * Jev is deliberately a routing signal, not a replacement for Luca's parser,
 * read tools, auditor, or answer-writing model. Keep it server-only and fail
 * open to the existing normalizer whenever Gateway is unavailable.
 */
export function jevMode(): "off" | "shadow" | "replace" {
  const mode = process.env.LUCA_JEV_NORMALIZER_MODE;
  return mode === "replace" || mode === "shadow" ? mode : "off";
}

/**
 * Minimum Jev confidence required before replace mode may alter the normalizer
 * path. A missing or malformed value keeps the conservative default; shadow mode
 * still records every classification for calibration.
 */
export function jevReplaceMinConfidence(): number {
  const configured = Number(process.env.LUCA_JEV_REPLACE_MIN_CONFIDENCE);
  return Number.isFinite(configured) && configured >= 0 && configured <= 1
    ? configured
    : 0.8;
}

/**
 * The only behavior-changing Jev gate. Keeping this pure makes the rollout
 * policy testable without a gateway call: shadow mode never changes routing,
 * and replace mode only bypasses the cheap normalizer for high-confidence
 * live-data or reasoning requests.
 */
export function shouldSkipNormalizer(input: {
  mode: "off" | "shadow" | "replace";
  route: JevRoute | null;
  confidence: number | null;
  minimum: number;
}): boolean {
  return (
    input.mode === "replace" &&
    input.route !== null &&
    input.confidence !== null &&
    input.confidence >= input.minimum &&
    (input.route === "read_only" || input.route === "full_reasoning")
  );
}

function confidence(
  probabilities: Record<string, number> | undefined,
): number | null {
  if (!probabilities) return null;
  return Object.values(probabilities).reduce(
    (best, value) => Math.max(best, Number(value) || 0),
    0,
  );
}

export async function classifyLucaRoute(input: {
  message: string;
  chainId?: number;
  walletConnected: boolean;
  mainnetOnly: boolean;
  visibleTokens: string[];
}): Promise<JevRouteResult | null> {
  if (jevMode() === "off") return null;
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return null;
  }

  try {
    const result = await evaluate({
      model: "typesafe-ai/jev",
      state: {
        message: input.message,
        chainId: input.chainId ?? null,
        walletConnected: input.walletConnected,
        mainnetOnly: input.mainnetOnly,
        visibleTokens: input.visibleTokens,
        rule: "This decision selects Luca's next processing path. It never executes a transaction and never answers the user.",
      },
      questions: {
        route: {
          type: "choice",
          instructions:
            "Choose the single best Luca processing path for this message.",
          criteria: {
            transaction_plan:
              "The user clearly asks Luca to perform a DeFi action and supplies enough explicit arguments for the existing tool/parser path.",
            read_only:
              "The user asks for live wallet, pool, price, route, position, bridge, or other chain data. This includes requests to list which liquidity pools or markets are currently live, pool TVL/volume/fees, current prices, balances, or positions; these are read-only even when the answer needs a chain read tool.",
            faq: "The message is a static product or documentation question answerable without current chain data.",
            clarification:
              "The user intent is understandable but a required token, amount, chain, or choice is missing or ambiguous.",
            full_reasoning:
              "The message needs strategy, comparison, multi-step reasoning, or a judgment that the quick path should not attempt.",
          },
        },
      },
      maxRetries: 1,
      providerOptions: { gateway: { zeroDataRetention: true } },
    });

    const answer = result.answers.route;
    const route = answer.choice as JevRoute;
    if (!JEV_ROUTES.includes(route)) {
      return null;
    }
    return {
      route,
      confidence: confidence(answer.probabilities),
      probabilities: answer.probabilities ?? null,
    };
  } catch (error) {
    console.warn(
      "[chat] Jev route evaluation failed; using existing path:",
      error,
    );
    return null;
  }
}
