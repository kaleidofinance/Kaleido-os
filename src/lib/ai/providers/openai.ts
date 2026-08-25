import type {
  ChatInput,
  ChatProvider,
  ChatResult,
  ExecuteCall,
  ReadCall,
} from "../types";
import { EXECUTE_TOOLS } from "../toolCatalog";

/**
 * OpenAI provider — Chat Completions API, function-calling form.
 *
 * Same neutral interface as ClaudeProvider: system + messages + tools in,
 * { text, plan } out. The tool catalog and the plan shape are provider-
 * agnostic, so switching providers changes zero call sites — only which
 * adapter the factory in ./index picks.
 *
 * The base URL is injectable, matching ClaudeOptions, so this adapter serves
 * any gateway speaking Chat Completions — OpenRouter, LiteLLM, Azure, a
 * self-hosted proxy. "OpenAI-compatible" is a claim about the body shape, and
 * the body shape is the only thing an adapter encodes, so a compatible gateway
 * is a parameter rather than a file.
 */

interface OpenAIToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface OpenAIOptions {
  /** Include the version segment — "/chat/completions" is appended. */
  baseUrl?: string;
  /** Reported as `provider` in the result, so logs name the actual hop. */
  id?: string;
  /**
   * Overrides the User-Agent. Some gateways allowlist client UAs and reject
   * everything else with a 401 that reads like a bad key — see OPENAI_USER_AGENT
   * in .env.example, which documents the one gateway this was needed for and why
   * setting it is a decision rather than a default. Unset sends the runtime's own
   * UA, which is what a first-party API expects.
   */
  userAgent?: string;
  /**
   * Omitted from the body entirely when unset, which is the default and what
   * every model already does — an absent cap means the model's own maximum.
   * Sent as `max_completion_tokens`, not `max_tokens`: the gpt-5 and o-series
   * families reject the older field outright. A gateway old enough to want
   * `max_tokens` will ignore this one, which degrades to the unset behaviour
   * rather than erroring.
   */
  maxTokens?: number;
}

export class OpenAIProvider implements ChatProvider {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly maxTokens?: number;
  private readonly userAgent?: string;

  constructor(
    private readonly apiKey: string,
    readonly model = "gpt-5",
    opts: OpenAIOptions = {},
  ) {
    this.id = opts.id ?? "openai";
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );
    this.maxTokens = opts.maxTokens;
    this.userAgent = opts.userAgent;
  }

  async chat({ system, messages, tools }: ChatInput): Promise<ChatResult> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...(this.userAgent ? { "user-agent": this.userAgent } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        ...(this.maxTokens ? { max_completion_tokens: this.maxTokens } : {}),
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

    /* Verb + arguments, matching ClaudeProvider. Building intents here would
       put a second copy of that translation in the tree, and the two copies
       would drift the first time a verb gained a field. */
    const executes: ExecuteCall[] = calls
      .filter((c) => EXECUTE_TOOLS.has(c.function.name))
      .map((c) => ({
        name: c.function.name,
        args: parseArgs(c.function.arguments),
      }));

    // Every non-execute call is a READ request — reachable, not dropped.
    const reads: ReadCall[] = calls
      .filter((c) => !EXECUTE_TOOLS.has(c.function.name))
      .map((c) => ({
        name: c.function.name,
        args: parseArgs(c.function.arguments),
      }));

    return {
      text: (message?.content ?? "").trim(),
      executes,
      reads,
      provider: this.id,
      model: this.model,
    };
  }
}
