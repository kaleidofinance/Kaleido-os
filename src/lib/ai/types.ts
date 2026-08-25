/**
 * Provider-agnostic AI layer for Luca.
 *
 * The backend can speak to Claude, OpenAI, or any other provider — the choice
 * is made from whichever API key is configured (see ./index). Every provider
 * implements one interface and consumes one neutral tool catalog, so adding a
 * provider is a new adapter, and adding a capability is a new tool — neither
 * touches the other, and neither touches the frontend.
 *
 * The output contract is the same one the frontend already validates and
 * signs: a plan is an array of intents (src/lib/v2/intents). The model decides
 * which tools to call; its "execute" tool calls become the plan.
 */

/** A neutral tool definition, translated per-provider by each adapter. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
  /**
   * "execute" tools become signable plan intents (their name is the intent
   * kind). "read" tools fetch on-chain/market context to ground the model's
   * reasoning — declared here, executed server-side in the agent loop.
   */
  kind: "execute" | "read";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** One step of a plan — a serialisable intent matching the registry union. */
export interface PlanStep {
  kind: string;
  [key: string]: unknown;
}

/** A READ tool the model asked for — awaiting server-side execution. */
export interface ReadCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * An EXECUTE verb the model asked for — awaiting server-side building.
 *
 * Deliberately not a PlanStep. A provider used to spread a tool call's
 * arguments straight into `{kind: toolName, ...input}` and call the result a
 * plan, which made tool name and intent kind the same thing and forced every
 * field of an Intent to be something the model typed — including contract
 * addresses it was never shown. The call and the intent are now separate
 * shapes, and `fromToolCall.planFromToolCalls` is what turns one into the
 * other, in one place rather than once per provider.
 */
export interface ExecuteCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ChatResult {
  /** The model's natural-language reply. */
  text: string;
  /** Execute verbs the model chose; empty when it only conversed. */
  executes: ExecuteCall[];
  /**
   * READ tools the model requested this turn. Every tool in the catalog is
   * reachable through this array — the agent loop executes each and feeds
   * results back, not just a hardcoded default. Empty once the model has
   * enough context and moves to a plan or a plain reply.
   */
  reads: ReadCall[];
  provider: string;
  model: string;
}

export interface ChatInput {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
}

/** What every model provider implements. */
export interface ChatProvider {
  readonly id: string;
  readonly model: string;
  chat(input: ChatInput): Promise<ChatResult>;
}
