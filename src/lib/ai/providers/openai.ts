import type { ChatInput, ChatProvider, ChatResult, PlanStep } from "../types";
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

    const plan: PlanStep[] = (message?.tool_calls ?? [])
      .filter((c) => EXECUTE_TOOLS.has(c.function.name))
      .map((c) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.function.arguments);
        } catch {
          console.warn("[openai] unparseable tool arguments:", c.function.arguments);
        }
        return { kind: c.function.name, ...args };
      });

    return {
      text: (message?.content ?? "").trim(),
      plan,
      provider: this.id,
      model: this.model,
    };
  }
}
