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
 * Every READ tool in the catalog is reachable here — not just a hardcoded
 * default. Whatever the model calls (getQuote, getPortfolio, getMarkets,
 * getChains, in any combination or order) gets executed server-side and fed
 * back, so "plan across protocols and chains" actually has the tools to do
 * it: check markets, get a quote, check where funds sit across chains, then
 * commit to a plan.
 *
 * Bounded at MAX_READ_ROUNDS so a model that never converges can't loop
 * forever — after the cap we return whatever text it has rather than error.
 *
 * On the very first turn, if the model didn't ask for anything but we have a
 * wallet address, we still seed portfolio context — most opening messages
 * ("what should I do?") benefit from it even when the model doesn't think to
 * ask, and it costs one extra read tool call to get right by default.
 */

const MAX_READ_ROUNDS = 3;

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
  let seededPortfolio = false;

  for (let round = 0; round < MAX_READ_ROUNDS; round++) {
    // Execute verbs mean it had what it needed — stop.
    if (result.executes.length > 0) break;

    let contextBlock: string | null = null;

    if (result.reads.length > 0) {
      // Run exactly what the model asked for, whatever mix of tools that is,
      // all against the chain the user is actually connected to.
      const resolved = await Promise.all(
        result.reads.map(async (r) => ({
          tool: r.name,
          args: r.args,
          result: await runReadTool(r.name, r.args, input.chainId),
        })),
      );
      contextBlock = JSON.stringify(resolved, null, 2);
    } else if (!seededPortfolio && input.address) {
      // Default seed: only once, only when the model asked for nothing.
      seededPortfolio = true;
      const portfolio = await runReadTool(
        "getPortfolio",
        { address: input.address },
        input.chainId,
      );
      contextBlock = JSON.stringify(
        [
          {
            tool: "getPortfolio",
            args: { address: input.address },
            result: portfolio,
          },
        ],
        null,
        2,
      );
    } else {
      // Nothing left to ground on — whatever text the model has is final.
      break;
    }

    messages.push({
      role: "assistant",
      content: result.text || "(tool calls only)",
    });
    messages.push({
      role: "user",
      content:
        `Tool results:\n\n${contextBlock}\n\n` +
        "Use only this data — don't estimate. If you now have enough to answer or " +
        "propose a plan, do so; call execute tools for anything signable. If you still " +
        "need more information, call another read tool.",
    });

    result = await provider.chat({ system, messages, tools: TOOL_CATALOG });
  }

  return result;
}
