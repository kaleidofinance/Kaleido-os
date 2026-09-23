/**
 * Safe boundary for an optional browser-local language model.
 *
 * A local model may classify the user's wording or summarize context, but it
 * must never emit transaction fields. The deterministic grammar/planner remains
 * the only authority for amounts, token addresses, routes, fees, and calldata.
 */

export type LocalTurnKind = "fresh" | "follow_up" | "question" | "unknown";

export interface LocalIntentContext {
  lastKind?: string;
  hasActiveTask: boolean;
  chainId?: number;
}

export interface LocalIntentClassification {
  kind: LocalTurnKind;
  /** A short, user-visible reason; never model chain data or transaction args. */
  reason?: string;
  /** Only references to prior context are allowed through this boundary. */
  reference?: "previous_command" | "active_task" | "none";
}

export interface BrowserLocalIntentModel {
  classify(
    text: string,
    context: LocalIntentContext,
  ): Promise<LocalIntentClassification>;
}

export interface BrowserLocalIntentModelOptions {
  /** Hugging Face model id. Kept configurable so Luca can A/B test candidates. */
  modelId?: string;
  /** Prefer GPU; the adapter falls back to WASM when it is unavailable. */
  device?: "webgpu" | "wasm";
  /** Quantized ONNX dtype. q4 is the broadest small-device choice. */
  dtype?: "q4" | "q4f16" | "int8" | "fp16";
}

export const DEFAULT_BROWSER_LOCAL_INTENT_MODEL =
  "onnx-community/SmolLM2-360M-Instruct-ONNX";

export function browserLocalIntentOptions(): Required<BrowserLocalIntentModelOptions> {
  return {
    modelId:
      process.env.NEXT_PUBLIC_LOCAL_INTENT_MODEL ||
      DEFAULT_BROWSER_LOCAL_INTENT_MODEL,
    device: "webgpu",
    dtype: "q4",
  };
}

const KINDS = new Set<LocalTurnKind>([
  "fresh",
  "follow_up",
  "question",
  "unknown",
]);
const REFERENCES = new Set([
  "previous_command",
  "active_task",
  "none",
]);

/**
 * Validates untrusted model output into the tiny envelope the router accepts.
 * Anything else falls back to `unknown`, which sends the message through the
 * existing server/model path rather than allowing malformed data to reach a
 * transaction builder.
 */
export function validateLocalClassification(
  value: unknown,
): LocalIntentClassification {
  if (!value || typeof value !== "object") return { kind: "unknown" };
  const raw = value as Record<string, unknown>;
  const kind = typeof raw.kind === "string" && KINDS.has(raw.kind as LocalTurnKind)
    ? (raw.kind as LocalTurnKind)
    : "unknown";
  const reference =
    typeof raw.reference === "string" && REFERENCES.has(raw.reference)
      ? (raw.reference as LocalIntentClassification["reference"])
      : undefined;
  const reason =
    typeof raw.reason === "string" && raw.reason.length <= 160
      ? raw.reason
      : undefined;
  return { kind, ...(reference ? { reference } : {}), ...(reason ? { reason } : {}) };
}

/** Browser capability check only; it does not load a model or make network calls. */
export function canUseBrowserLocalModel(): boolean {
  return typeof window !== "undefined" &&
    ("gpu" in navigator || "WebAssembly" in window);
}
