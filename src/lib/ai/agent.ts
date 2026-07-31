import {
  TOOL_CATALOG,
  buildSystemPrompt,
  runReadTool,
  type ChatMessage,
  type ChatProvider,
  type ChatResult,
  type Guardrails,
} from "./index";

/**
 * The agent loop.
 *
 * Luca gets one round of grounding before it commits to a plan: it asks for
 * whatever READ tools it needs, we execute them server-side, feed the results
 * back, and let it produce the final answer and plan. Two passes is the right
 * shape here — it's enough for "look at my positions, then propose", and it
 * bounds latency and spend far more predictably than an open-ended loop.
 *
 * Read-tool requests surface as text on the first pass (the providers only
 * return EXECUTE calls as plan steps), so we detect them by name and run them.
 * If the provider returns a plan immediately, we're done in one pass.
 */

const MAX_READ_ROUNDS = 1;

export interface AgentInput {
  message: string;
  address?: string;
  chainId?: number;
  limits?: Guardrails;
}

export async function runAgent(
  provider: ChatProvider,
  input: AgentInput,
): Promise<ChatResult> {
  const system = buildSystemPrompt({
    address: input.address,
    chainId: input.chainId,
    limits: input.limits,
  });

  const messages: ChatMessage[] = [{ role: "user", content: input.message }];

  let result = await provider.chat({ system, messages, tools: TOOL_CATALOG });

  // If the model already produced a plan, it had what it needed.
  if (result.plan.length > 0) return result;

  // Otherwise give it one grounding round: run the reads its answer implies,
  // hand back the data, and ask again.
  for (let round = 0; round < MAX_READ_ROUNDS; round++) {
    const context = await gatherContext(input);
    if (!context) break;

    messages.push({ role: "assistant", content: result.text });
    messages.push({
      role: "user",
      content:
        `Here is the current on-chain data for this account:\n\n${context}\n\n` +
        "Using only these figures, give your answer. If you are proposing actions, call the execute tools now.",
    });

    result = await provider.chat({ system, messages, tools: TOOL_CATALOG });
    if (result.plan.length > 0) break;
  }

  return result;
}

/**
 * Fetches the context Luca almost always needs — the user's position — and
 * formats it for the model. Returns null when there's no address to read.
 */
async function gatherContext(input: AgentInput): Promise<string | null> {
  if (!input.address) return null;
  const portfolio = await runReadTool("getPortfolio", { address: input.address });
  return JSON.stringify(portfolio, null, 2);
}
