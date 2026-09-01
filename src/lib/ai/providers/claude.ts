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
 * Claude provider — Anthropic Messages API.
 *
 * REST rather than the SDK on purpose: this gateway stays dependency-free so a
 * provider is a ~60-line adapter, not an npm install. The request shape is the
 * documented Opus 5 tool-use form (adaptive thinking is on by default and left
 * implicit; tools carry input_schema). Swap the body for `@anthropic-ai/sdk`
 * later without touching the interface if you prefer.
 *
 * The base URL is injectable so this same adapter serves any gateway speaking
 * the Messages format — AgentRouter, LiteLLM, a self-hosted proxy. That is a
 * one-parameter change rather than a third adapter because the wire format is
 * what an adapter encodes, and a router that reimplements Anthropic's format is
 * by definition the same wire format. Forking the file would have left two
 * copies of the tool-use parsing to keep in sync.
 */

interface AnthropicBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ClaudeOptions {
  /** Origin only, no path — "/v1/messages" is appended. */
  baseUrl?: string;
  /** Reported as `provider` in the result, so logs name the actual hop. */
  id?: string;
  maxTokens?: number;
  /**
   * Overrides the User-Agent. Some gateways allowlist client UAs and reject
   * everything else with a 401 that reads like a bad key — see
   * AGENTROUTER_USER_AGENT in .env.example, which documents the one gateway this
   * was needed for and why setting it is a decision rather than a default. Unset
   * sends the runtime's own UA, which is what api.anthropic.com expects.
   */
  userAgent?: string;
}

export class ClaudeProvider implements ChatProvider {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;
  private readonly userAgent?: string;

  constructor(
    private readonly apiKey: string,
    readonly model = "claude-opus-5",
    opts: ClaudeOptions = {},
  ) {
    this.id = opts.id ?? "claude";
    this.baseUrl = (opts.baseUrl ?? "https://api.anthropic.com").replace(
      /\/+$/,
      "",
    );
    this.maxTokens = opts.maxTokens ?? 4096;
    this.userAgent = opts.userAgent;
  }

  /**
   * The one place the wire request is built, for both the buffered and the
   * streamed call. `stream` is the only difference between them — everything
   * that could drift (auth, version, tool translation, the timeout) stays
   * single-copy, so a fix to the buffered path cannot silently miss the
   * streaming one.
   */
  private async request(
    { system, messages, tools }: ChatInput,
    stream: boolean,
  ): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        /* Both auth headers, deliberately. Anthropic authenticates on
           `x-api-key`; most compatible routers accept it too, but several
           (AgentRouter included) are built on OpenAI-style middleware that
           reads `Authorization`. Sending one and guessing wrong is a 401 that
           looks like a bad key. Sending both is accepted by every gateway
           tested — the unused header is ignored. */
        authorization: `Bearer ${this.apiKey}`,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        ...(this.userAgent ? { "user-agent": this.userAgent } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
        ...(stream ? { stream: true } : {}),
      }),
      /* Covers the body too, not just the headers, so this is the ceiling on a
         whole streamed answer rather than on time-to-first-byte. Left the same
         for both calls: streaming changes when text is handed over, not how
         long the model is allowed to take. */
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${this.id} ${res.status}: ${detail.slice(0, 200)}`);
    }

    return res;
  }

  /**
   * Content blocks → the neutral result. Shared, so the streamed turn and the
   * buffered one are parsed by the same code and cannot disagree about what the
   * model asked for.
   */
  private finish(
    blocks: AnthropicBlock[],
    stopReason: string | undefined,
  ): ChatResult {
    // A safety-classifier decline is a normal 200, not an error — surface it
    // as a plain reply rather than throwing and losing the turn.
    if (stopReason === "refusal") {
      return {
        text: "I can't help with that request.",
        executes: [],
        reads: [],
        provider: this.id,
        model: this.model,
      };
    }

    const text = blocks
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n")
      .trim();

    const toolUses = blocks.filter((b) => b.type === "tool_use" && b.name);

    /* Handed on as verb + arguments, not spread into a plan step. The
       arguments are the user's words — an amount, a symbol, an id — and it is
       fromToolCall/buildIntents that turns them into intents carrying real
       addresses and decimals. Doing that here would mean doing it twice, once
       per provider. */
    const executes: ExecuteCall[] = toolUses
      .filter((b) => EXECUTE_TOOLS.has(b.name as string))
      .map((b) => ({ name: b.name as string, args: b.input ?? {} }));

    // Every non-execute tool_use is a READ request — none are dropped, so the
    // whole catalog is reachable, not just whichever tool got hardcoded.
    const reads: ReadCall[] = toolUses
      .filter((b) => !EXECUTE_TOOLS.has(b.name as string))
      .map((b) => ({ name: b.name as string, args: b.input ?? {} }));

    return { text, executes, reads, provider: this.id, model: this.model };
  }

  /**
   * The body as JSON, or an error naming whatever arrived instead.
   *
   * A gateway is not obliged to answer in JSON even when it answers 200, and a
   * `res.ok` check does not catch that. AgentRouter served Vercel's egress an
   * HTML document — a landing page, the model never reached — while answering
   * the byte-identical request from a developer machine with JSON. Handing that
   * body to `res.json()` reduces a diagnosable infrastructure block to
   * `SyntaxError: Unexpected token '<'`, which names neither the gateway, nor
   * the status, nor the fact that a redirect was followed. That is the whole
   * cost of the shortcut: the route logs the SyntaxError and the user reads
   * "the reasoning service returned an error".
   *
   * BY CONTENT, NOT BY CONTENT-TYPE. The obvious guard — reject anything whose
   * content-type is not JSON — would break every working call: **AgentRouter
   * returns valid JSON as `text/plain; charset=utf-8`**, measured on both the
   * direct host and through the relay. So the body is what decides, and the
   * content-type only appears in the error text as evidence.
   *
   * `res.url` is the other load-bearing part. fetch follows redirects silently,
   * so a final URL that is not the one we asked for is the difference between
   * "the API refused us" and "we were never talking to the API".
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
      content?: AnthropicBlock[];
      stop_reason?: string;
    }>(res);

    return this.finish(data.content ?? [], data.stop_reason);
  }

  async chatStream(
    input: ChatInput,
    onText: (delta: string) => void,
  ): Promise<ChatResult> {
    const res = await this.request(input, true);

    /* A gateway is free to ignore `stream: true` and answer with plain JSON.
       Detecting that from the content type costs one header read and keeps the
       turn alive — the caller simply gets no deltas, which every caller must
       already tolerate because `chatStream` is optional. */
    const ct = res.headers.get("content-type") ?? "";
    if (!res.body || !ct.includes("event-stream")) {
      const data = await this.parseJson<{
        content?: AnthropicBlock[];
        stop_reason?: string;
      }>(res);
      return this.finish(data.content ?? [], data.stop_reason);
    }

    /* Blocks in flight, keyed by the wire's index; finished ones move to
       `closed` as their stop frame arrives, which is index order, so the
       response's own ordering survives without a sort. */
    const open = new Map<
      number,
      { type: string; name?: string; text: string; json: string }
    >();
    const closed: AnthropicBlock[] = [];
    let stopReason: string | undefined;

    for await (const payload of sseData(res.body)) {
      let ev: {
        type?: string;
        index?: number;
        content_block?: { type?: string; name?: string };
        delta?: {
          type?: string;
          text?: string;
          partial_json?: string;
          stop_reason?: string;
        };
        error?: { message?: string; type?: string };
      };
      try {
        ev = JSON.parse(payload);
      } catch {
        /* A frame we cannot read is not a reason to lose the whole turn. */
        continue;
      }

      switch (ev.type) {
        case "content_block_start":
          open.set(ev.index ?? 0, {
            type: ev.content_block?.type ?? "text",
            name: ev.content_block?.name,
            text: "",
            json: "",
          });
          break;

        case "content_block_delta": {
          const block = open.get(ev.index ?? 0);
          if (!block) break;
          if (ev.delta?.type === "text_delta" && ev.delta.text) {
            block.text += ev.delta.text;
            onText(ev.delta.text);
          } else if (ev.delta?.type === "input_json_delta") {
            block.json += ev.delta.partial_json ?? "";
          }
          break;
        }

        case "content_block_stop": {
          const block = open.get(ev.index ?? 0);
          if (!block) break;
          open.delete(ev.index ?? 0);
          if (block.type === "tool_use") {
            /* Arguments arrive as JSON fragments, so they are only trustworthy
               once the block has closed. */
            const args = parseToolArgs(
              block.json,
              block.name ?? "tool",
              this.id,
            );
            if (args) {
              closed.push({ type: "tool_use", name: block.name, input: args });
            }
          } else if (block.type === "text") {
            closed.push({ type: "text", text: block.text });
          }
          break;
        }

        case "message_delta":
          stopReason = ev.delta?.stop_reason ?? stopReason;
          break;

        case "error":
          /* The gateway can fail mid-stream (overloaded, quota) after a 200 and
             a few frames. Throwing puts it on the same footing as an HTTP
             error, which is the path callers already handle. */
          throw new Error(
            `${this.id} stream error: ${ev.error?.message ?? ev.error?.type ?? "unknown"}`,
          );
      }
    }

    /* Anything still open never got its stop frame — a truncated stream. Text
       is kept because the user already read it; a tool call is not, for the
       same reason its arguments are parsed late. */
    for (const block of open.values()) {
      if (block.type === "text" && block.text) {
        closed.push({ type: "text", text: block.text });
      }
    }

    return this.finish(closed, stopReason);
  }
}
