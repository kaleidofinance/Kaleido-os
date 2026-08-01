/**
 * Intent bus — public surface.
 *
 * Importing this module registers every intent definition (the import of
 * ./definitions runs its register() calls as a side effect). Consumers import
 * from here, never from ./definitions directly.
 */
import "./definitions";

export { renderIntent, resolveIntent, isRegistered } from "./registry";
export { AGENT_ACTIONS } from "./types";
export type {
  Intent,
  IntentKind,
  IntentView,
  IntentResult,
  ResolverContext,
} from "./types";
