import type {
  Intent,
  IntentDef,
  IntentKind,
  IntentResult,
  IntentView,
  ResolverContext,
} from "./types";

/**
 * The registry. Type-erased internally (a Map can't hold the per-kind generic),
 * but register() is typed per kind so definitions stay checked at the edge.
 */
const registry = new Map<IntentKind, IntentDef<IntentKind>>();

export function register<K extends IntentKind>(kind: K, def: IntentDef<K>): void {
  registry.set(kind, def as unknown as IntentDef<IntentKind>);
}

function defFor(kind: IntentKind): IntentDef<IntentKind> {
  const def = registry.get(kind);
  if (!def) throw new Error(`No intent registered for "${kind}"`);
  return def;
}

/** Turn an intent into the row a human reads. Pure. */
export function renderIntent(intent: Intent): IntentView {
  return defFor(intent.kind).render(intent as never);
}

/** Sign and send the intent. */
export function resolveIntent(
  ctx: ResolverContext,
  intent: Intent,
): Promise<IntentResult> {
  return defFor(intent.kind).resolve(ctx, intent as never);
}

export function isRegistered(kind: IntentKind): boolean {
  return registry.has(kind);
}
