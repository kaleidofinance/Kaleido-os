import type { ChatInput, ChatProvider, ChatResult, PlanStep, ReadCall } from "../types";
import { EXECUTE_TOOLS } from "../toolCatalog";

/**
 * OpenAI provider — Chat Completions API, function-calling form.
 *
 * Same neutral interface as ClaudeProvider: system + messages + tools in,
 * { text, plan } out. The tool catalog and the plan shape are provider-
 * agnostic, so switching providers changes zero call sites — only which
 * adapter the factory in ./index picks.
 */

interface OpenAIToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export class OpenAIProvider implements ChatProvider {
  readonly id = "openai";
  constructor(
    private readonly apiKey: string,
    readonly model = "gpt-5",
  ) {}

  async chat({ system, messages, tools }: ChatInput): Promise<ChatResult> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        tools: tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: OpenAIToolCall[] };
      }>;
    };
    const message = data.choices?.[0]?.message;
    const calls = message?.tool_calls ?? [];

    const parseArgs = (raw: string): Record<string, unknown> => {
      try {
        return JSON.parse(raw);
      } catch {
        console.warn("[openai] unparseable tool arguments:", raw);
        return {};
      }
    };

    const plan: PlanStep[] = calls
      .filter((c) => EXECUTE_TOOLS.has(c.function.name))
      .map((c) => ({ kind: c.function.name, ...parseArgs(c.function.arguments) }));

    // Every non-execute call is a READ request — reachable, not dropped.
    const reads: ReadCall[] = calls
      .filter((c) => !EXECUTE_TOOLS.has(c.function.name))
      .map((c) => ({ name: c.function.name, args: parseArgs(c.function.arguments) }));

    return {
      text: (message?.content ?? "").trim(),
      plan,
      reads,
      provider: this.id,
      model: this.model,
    };
  }
}
