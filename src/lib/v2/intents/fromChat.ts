import { isRegistered, type Intent, type IntentKind } from "./index";

/**
 * Turns an /api/chat response into a plan the frontend can render and sign.
 *
 * This is the contract between Luca (the AI engine) and the UI: when the model
 * decides on actions, it returns them under `context.plan` as an array of
 * intents matching our Intent union — the same serialisable shape the registry
 * already renders and resolves. The engine only needs to emit intents; it never
 * touches calldata.
 *
 * We validate defensively — the model's output is untrusted. Only steps whose
 * `kind` is a registered intent survive; anything unknown is dropped (and
 * logged), so a malformed or hallucinated action can't reach a resolver. An
 * empty result means "no plan, just a text reply".
 *
 * Expected shape:
 *   { response: string, context?: { plan?: Intent[] } }
 */

interface ChatResponse {
  response?: string;
  context?: {
    plan?: unknown;
    [k: string]: unknown;
  };
}

const KNOWN_KINDS: IntentKind[] = [
  "approve",
  "swap",
  "stake",
  "grantAgentPermission",
];

function looksLikeIntent(x: unknown): x is Intent {
  if (!x || typeof x !== "object") return false;
  const kind = (x as { kind?: unknown }).kind;
  return (
    typeof kind === "string" &&
    (KNOWN_KINDS as string[]).includes(kind) &&
    isRegistered(kind as IntentKind)
  );
}

export function intentsFromChat(data: unknown): Intent[] {
  const chat = data as ChatResponse;
  const raw = chat?.context?.plan;
  if (!Array.isArray(raw)) return [];

  const valid: Intent[] = [];
  for (const step of raw) {
    if (looksLikeIntent(step)) {
      valid.push(step);
    } else {
      console.warn("[intentsFromChat] dropped unrecognised plan step:", step);
    }
  }
  return valid;
}
