import type {
  ChatInput,
  ChatProvider,
  ChatResult,
  ExecuteCall,
  ReadCall,
} from "../types";
import { EXECUTE_TOOLS } from "../toolCatalog";
import { sseData } from "./sse";
import { parseToolArgs } from "./toolArgs";

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

  /**
   * The one place the wire request is built, for both the buffered and the
   * streamed call — see the note on ClaudeProvider.request. `stream_options`
   * rides along with `stream` because without it several gateways omit the
   * final usage frame; it is ignored by the ones that don't need telling.
   */
  private async request(
    { system, messages, tools }: ChatInput,
    stream: boolean,
  ): Promise<Response> {
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
        ...(stream
          ? { stream: true, stream_options: { include_usage: true } }
          : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 200)}`);
    }

    return res;
  }

  /**
   * Text + tool calls → the neutral result. Shared, so the streamed turn and
   * the buffered one cannot disagree about what the model asked for.
   */
  private finish(text: string, calls: OpenAIToolCall[]): ChatResult {
    const args = (c: OpenAIToolCall) =>
      parseToolArgs(c.function.arguments, c.function.name, this.id);

    /* Verb + arguments, matching ClaudeProvider. Building intents here would
       put a second copy of that translation in the tree, and the two copies
       would drift the first time a verb gained a field. */
    const executes: ExecuteCall[] = [];
    // Every non-execute call is a READ request — reachable, not dropped.
    const reads: ReadCall[] = [];

    for (const c of calls) {
      const parsed = args(c);
      if (!parsed) continue;
      const call = { name: c.function.name, args: parsed };
      (EXECUTE_TOOLS.has(c.function.name) ? executes : reads).push(call);
    }

    return {
      text: text.trim(),
      executes,
      reads,
      provider: this.id,
      model: this.model,
    };
  }

  /**
   * The body as JSON, or an error naming whatever arrived instead.
   *
   * The twin of ClaudeProvider.parseJson, and here for the same reason: a
   * gateway can answer 200 with an HTML landing page, which `res.ok` does not
   * catch and `res.json()` reports only as `SyntaxError: Unexpected token '<'`.
   * Both router flavours sit behind the same host, so a block that hits one hits
   * the other.
   *
   * Judged by the body and not the content-type, because **AgentRouter returns
   * valid JSON as `text/plain`** — a content-type gate would reject every
   * working call. `res.url` catches the silent redirect fetch performs for us.
   */
  private async parseJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      const contentType = res.headers.get("content-type") ?? "";
      const detour =
        res.url && !res.url.startsWith(this.baseUrl)
          ? `, redirected to ${res.url}`
          : "";
      const body = text.replace(/\s+/g, " ").trim().slice(0, 200);
      throw new Error(
        `${this.id} answered ${res.status} with ` +
          `${contentType || "no content-type"}${detour} and a body that is ` +
          `not JSON — the request never reached the model. ` +
          `Body: ${body || "(empty)"}`,
      );
    }
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const res = await this.request(input, false);

    const data = await this.parseJson<{
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: OpenAIToolCall[] };
      }>;
    }>(res);
    const message = data.choices?.[0]?.message;

    return this.finish(message?.content ?? "", message?.tool_calls ?? []);
  }

  async chatStream(
    input: ChatInput,
    onText: (delta: string) => void,
  ): Promise<ChatResult> {
    const res = await this.request(input, true);

    /* A gateway is free to ignore `stream: true` and answer with plain JSON.
       Detecting that from the content type keeps the turn alive — the caller
       simply gets no deltas, which every caller must already tolerate because
       `chatStream` is optional. */
    const ct = res.headers.get("content-type") ?? "";
    if (!res.body || !ct.includes("event-stream")) {
      const data = await this.parseJson<{
        choices?: Array<{
          message?: { content?: string | null; tool_calls?: OpenAIToolCall[] };
        }>;
      }>(res);
      const message = data.choices?.[0]?.message;
      return this.finish(message?.content ?? "", message?.tool_calls ?? []);
    }

    let text = "";
    /* Accumulated by `index`, not by array position: a delta names the slot it
       belongs to and only the first one for a slot carries the function name,
       so appending in arrival order would splice two calls' arguments together
       the moment a model asks for more than one tool. */
    const parts = new Map<number, { name: string; args: string }>();

    for await (const payload of sseData(res.body)) {
      if (payload === "[DONE]") break;

      let ev: {
        choices?: Array<{
          delta?: {
            content?: string | null;
            tool_calls?: Array<{
              index?: number;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
        error?: { message?: string; type?: string };
      };
      try {
        ev = JSON.parse(payload);
      } catch {
        /* A frame we cannot read is not a reason to lose the whole turn. */
        continue;
      }

      /* Mid-stream failure after a 200 — same footing as an HTTP error, which
         is the path callers already handle. */
      if (ev.error) {
        throw new Error(
          `OpenAI stream error: ${ev.error.message ?? ev.error.type ?? "unknown"}`,
        );
      }

      const delta = ev.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        text += delta.content;
        onText(delta.content);
      }

      for (const tc of delta.tool_calls ?? []) {
        const slot = tc.index ?? 0;
        const part = parts.get(slot) ?? { name: "", args: "" };
        if (tc.function?.name) part.name = tc.function.name;
        part.args += tc.function?.arguments ?? "";
        parts.set(slot, part);
      }
    }

    const calls: OpenAIToolCall[] = [...parts.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, p]) => p.name)
      .map(([slot, p]) => ({
        id: `stream-${slot}`,
        function: { name: p.name, arguments: p.args },
      }));

    return this.finish(text, calls);
  }
}
