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

/**
 * The one gate on an incoming plan step: does a resolver exist for its `kind`?
 *
 * `isRegistered` IS the authority — the same predicate registry.test.ts derives
 * over every kind in the union — so a step whose kind can be rendered and signed
 * survives, and nothing else does. It replaced a hand-written `KNOWN_KINDS`
 * allow-list that sat here and rotted: it named 25 of the 35 registered kinds, so
 * a model plan containing `swapMultiHop`, `transfer`, `bridge`, a limit order, an
 * unstake step or a cross-chain route was silently dropped, and the user saw
 * prose promising a plan with no steps to sign — the exact "silently shorter
 * plan" the /api/chat route forbids on its own side. A second list of kinds is a
 * second thing to keep in step with the union, and this one had already fallen
 * ten behind. There is no longer a list: `fromChat.test.ts` asserts every kind in
 * `ALL_INTENT_KINDS` survives this function, so a new kind is covered the day it
 * reaches the union.
 *
 * The rest of the intent's shape is not checked here on purpose: the server
 * audited the plan before sending it (lib/ai/auditor.ts), and re-validating every
 * field against the union would be a third copy of the auditor. This gate answers
 * only "can the UI render and resolve this kind at all".
 */
function looksLikeIntent(x: unknown): x is Intent {
  if (!x || typeof x !== "object") return false;
  const kind = (x as { kind?: unknown }).kind;
  return typeof kind === "string" && isRegistered(kind as IntentKind);
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
