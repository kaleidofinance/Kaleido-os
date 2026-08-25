import type {
  ChatInput,
  ChatProvider,
  ChatResult,
  ExecuteCall,
  ReadCall,
} from "../types";
import { EXECUTE_TOOLS } from "../toolCatalog";

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

  async chat({ system, messages, tools }: ChatInput): Promise<ChatResult> {
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
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${this.id} ${res.status}: ${detail.slice(0, 200)}`);
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
        executes: [],
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
}
