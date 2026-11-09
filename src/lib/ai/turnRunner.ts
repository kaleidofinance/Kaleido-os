import {
  runAgentWithFailover,
  type AgentEvents,
  type AgentInput,
  type AgentRun,
} from "./agent";
import type { ChatProvider } from "./types";

/** Dependencies owned by the server route for one model turn. */
export interface TurnRunnerInput {
  providers: readonly ChatProvider[];
  input: AgentInput;
  events?: AgentEvents;
}

/**
 * The single provider/runtime seam for Luca turns.
 *
 * Route code should not call a provider directly. This keeps provider ordering,
 * retries, streaming stall detection, and the bounded agent loop behind one
 * contract while preserving the existing deterministic plan/audit boundary.
 */
export async function runTurn({
  providers,
  input,
  events,
}: TurnRunnerInput): Promise<AgentRun> {
  const chain = providers.filter(Boolean);
  if (chain.length === 0) throw new Error("No model provider configured.");
  return runAgentWithFailover([...chain], input, events);
}
