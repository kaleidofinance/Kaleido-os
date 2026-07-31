import type { ChatInput, ChatProvider, ChatResult, PlanStep, ReadCall } from "../types";
import { EXECUTE_TOOLS } from "../toolCatalog";

/**
 * Claude provider — Anthropic Messages API.
 *
 * REST rather than the SDK on purpose: this gateway stays dependency-free so a
 * provider is a ~60-line adapter, not an npm install. The request shape is the
 * documented Opus 5 tool-use form (adaptive thinking is on by default and left
 * implicit; tools carry input_schema). Swap the body for `@anthropic-ai/sdk`
 * later without touching the interface if you prefer.
 */

interface AnthropicBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export class ClaudeProvider implements ChatProvider {
  readonly id = "claude";
  constructor(
    private readonly apiKey: string,
    readonly model = "claude-opus-5",
  ) {}

  async chat({ system, messages, tools }: ChatInput): Promise<ChatResult> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Claude ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      content?: AnthropicBlock[];
      stop_reason?: string;
    };

    // A safety-classifier decline is a normal 200, not an error — surface it
    // as a plain reply rather than throwing and losing the turn.
    if (data.stop_reason === "refusal") {
      return {
        text: "I can't help with that request.",
        plan: [],
        reads: [],
        provider: this.id,
        model: this.model,
      };
    }

    const blocks = data.content ?? [];

    const text = blocks
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n")
      .trim();

    const toolUses = blocks.filter((b) => b.type === "tool_use" && b.name);

    const plan: PlanStep[] = toolUses
      .filter((b) => EXECUTE_TOOLS.has(b.name as string))
      .map((b) => ({ kind: b.name as string, ...(b.input ?? {}) }));

    // Every non-execute tool_use is a READ request — none are dropped, so the
    // whole catalog is reachable, not just whichever tool got hardcoded.
    const reads: ReadCall[] = toolUses
      .filter((b) => !EXECUTE_TOOLS.has(b.name as string))
      .map((b) => ({ name: b.name as string, args: b.input ?? {} }));

    return { text, plan, reads, provider: this.id, model: this.model };
  }
}
