import { NextRequest, NextResponse } from "next/server";
import {
  getProvider,
  isRouterModel,
  ROUTER_MODELS,
  ROUTER_MODEL_IDS,
} from "@/lib/ai";
import { runAgent, type AgentRun } from "@/lib/ai/agent";
import { planFromToolCalls } from "@/lib/ai/fromToolCall";
import { serverPlanDeps } from "@/lib/ai/planDeps";
import { auditPlan, refusalText } from "@/lib/ai/auditor";
import {
  consumeModelRequest,
  peekModelUsage,
  releaseModelRequest,
} from "@/lib/ai/credits";
import { condenseNote, type ChatStreamEvent } from "@/lib/v2/chatStream";

/**
 * A turn is not a fast request and never was. Measured against the live
 * gateway, a two-round answer takes 16–19 seconds wall clock; three rounds with
 * tool work between them takes longer, and each round's own ceiling is 60s.
 * The platform default for a serverless function is well under that, which
 * would kill the function mid-answer — before streaming that surfaced as a
 * truncated error, and with streaming it would cut the prose off mid-sentence.
 * 60 is the most the Hobby plan allows; the client survives an overrun anyway
 * (no terminal frame means it keeps the partial text and says the connection
 * dropped), but the point is not to need that.
 */
export const maxDuration = 60;

/**
 * Reports remaining model quota without spending any, so the UI can show a
 * balance on load. Kept separate from POST because rendering a number must
 * never cost a request.
 *
 * Also returns the selectable models. Only the ids the server can actually
 * reach are listed — the router key is what entitles them, so without it the
 * list is empty and a picker renders nothing rather than offering a choice that
 * would 403. Ids and labels only; no keys, no base URLs.
 */
export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("address") ?? undefined;
  const usage = await peekModelUsage(wallet);
  const models = process.env.AGENTROUTER_API_KEY
    ? ROUTER_MODEL_IDS.map((id) => ({ id, label: ROUTER_MODELS[id].label }))
    : [];
  return NextResponse.json({
    provider: Boolean(getProvider()),
    models,
    defaultModel: process.env.AGENTROUTER_MODEL ?? null,
    ...usage,
  });
}

// The AI Engine API URL and timeout (set in environment variables)
const AI_ENGINE_API_URL =
  process.env.AI_ENGINE_API_URL || "http://127.0.0.1:8000";
const AI_ENGINE_TIMEOUT = parseInt(
  process.env.AI_ENGINE_TIMEOUT || "300000",
  10,
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // --- Provider-agnostic agent loop -----------------------------------
    // When an AI key is configured (Claude, OpenAI, …) Luca runs here: read
    // tools ground the reasoning, execute tools become the signable plan the
    // frontend renders via PlanReview. Falls through to the legacy AI-engine
    // proxy below when no key is set, so existing deployments are unaffected.
    //
    // body.model is client input, so it is checked against the catalogue rather
    // than forwarded. An allowlist and not a sanitiser: the value reaches a
    // metered third-party API, so an unrecognised id must not be able to spend
    // a request discovering it is invalid, and the field must not become a way
    // to aim this server's key at an arbitrary model. Anything unrecognised is
    // dropped and the env default answers.
    const requested =
      typeof body.model === "string" && isRouterModel(body.model)
        ? body.model
        : undefined;
    const provider = getProvider(requested);
    if (provider) {
      // Quota is spent here, at the point of dispatch, and nowhere earlier.
      // A turn the client answered locally never reaches this route at all, so
      // routing locally first is what makes the allowance go far.
      const quota = await consumeModelRequest(body.address);
      if (!quota.allowed) {
        return NextResponse.json(
          {
            response: !body.address
              ? "Connect your wallet to use the reasoning engine. Direct commands like `swap 500 USDC to KLD` work without it."
              : `You've used all ${quota.quota} reasoning requests for today. Direct commands still work, and the allowance resets at 00:00 UTC.`,
            context: {
              status: "quota_exhausted",
              credits: { used: quota.used, quota: quota.quota, remaining: 0 },
            },
          },
          { status: 429 },
        );
      }

      /*
       * `chainId` goes to all three of planFromToolCalls, serverPlanDeps and
       * auditPlan below, and it has to be the same value in all three or the
       * plan mixes chains: token symbols resolve in the builder, contract
       * addresses resolve in the deps, and the pins are checked in the auditor.
       */
      const chainId =
        typeof body.chainId === "number" ? body.chainId : undefined;

      const agentInput = {
        message: String(body.message ?? ""),
        address: body.address,
        chainId: body.chainId,
        limits: body.limits,
      };

      /**
       * Everything that happens after the model stops talking: build, audit,
       * assemble the reply.
       *
       * Factored out because there are now two ways to run a turn and only one
       * correct way to finish one. A streamed turn that built its own payload
       * would be a second copy of the auditor call — and a copy that forgot it
       * would stream a plan nothing had checked.
       */
      const settle = async (result: AgentRun) => {
        /*
         * Verbs become intents here, before anything is audited.
         *
         * The model chose a verb and the arguments the user actually stated;
         * this is where contract addresses, decimals, fee tiers, quotes and
         * slippage floors get filled in — from the registry and from chain
         * reads, through the same builder the typed-command path uses. Doing
         * it at the route rather than in each provider adapter means one
         * translation, not one per provider.
         */
        const built = await planFromToolCalls(
          result.executes,
          chainId,
          serverPlanDeps(body.address, chainId),
          {
            slippageBps: body.limits?.slippageBps ?? 50,
            deadlineMin: 20,
          },
        );

        /*
         * The auditor pass, on the path that actually serves turns.
         *
         * This used to sit after the legacy AI-engine fetch below, which this
         * branch returns before reaching — so a plan from Claude, OpenAI or
         * AgentRouter was checked by nothing. The prompt states the user's
         * limits; a prompt is a request, not an enforcement point.
         *
         * It audits the BUILT plan, not the model's tool calls. That ordering
         * is what lets the rules keep checking real addresses and real
         * amountOutMin values even though the model now supplies neither — the
         * builder is trusted to construct, and the auditor still verifies what
         * was constructed.
         *
         * A rejected plan is dropped WHOLE, and never trimmed to its passing
         * steps. A plan is ordered and interdependent — an approve exists to
         * enable the swap after it — so removing one step leaves a sequence
         * that means something different from anything the model proposed or
         * the user read. The prose survives, because the reasoning is often
         * right even when a step is malformed, and the user can still act on it
         * with a direct command.
         *
         * `body.limits` and `allowedActions` are client input. The auditor
         * treats them as tightening-only against its own ceiling — a request
         * cannot raise its own cap by claiming a larger one.
         */
        const verdict = await auditPlan({
          plan: built.plan,
          chainId,
          limits: body.limits,
          allowedActions: body.limits?.allowedActions,
        });

        if (!verdict.ok) {
          console.warn(
            "[chat] auditor rejected plan:",
            JSON.stringify(verdict.blocked),
          );
        }

        /* A verb that couldn't be built is reported, not swallowed. Returning
           a quietly shorter plan would let the user believe the model's prose
           described what they were about to sign. */
        const buildNotes = built.errors.length
          ? `\n\n---\n\nI couldn't prepare some of that:\n${built.errors.map((e) => `• ${e}`).join("\n")}`
          : "";

        return {
          response: verdict.ok
            ? `${result.text}${buildNotes}`
            : /* The model's own words, then the refusal. Dropping the prose
                 would hide the analysis the user paid a request for. */
              `${result.text}${buildNotes}\n\n---\n\n${refusalText(verdict)}`,
          context: {
            plan: verdict.ok ? built.plan : [],
            provider: result.provider,
            model: result.model,
            /* What the model read before answering, in the order it ran.
               Reported so the turn can show its own work: the frontend renders
               these as the thought process under the reply (traceFromChat in
               src/lib/v2/agentTurn.ts), which is the only part of the reasoning
               this route can state as fact — no provider thinking is requested,
               so there is no chain of thought to forward, but which questions
               it asked about the chain is a matter of record.

               Sent on the streaming path too, identically, even though the
               client was already told about each read as it happened. Keeping
               one payload shape means one `settle` and one thing to reason
               about; the client's job is simply not to draw them twice.

               Names and arguments, no results. A result is the data the answer
               was built from and it is already in the prose; echoing it here
               would send the same portfolio twice and put it in a place the
               client would have to re-validate. */
            reads: result.trace,
            /* Reported either way. A caller that sees `plan: []` deserves to
               know whether the model proposed nothing or proposed something
               that was refused — those are different answers, and the old gate
               conflated them by returning a bare sentence. */
            audit: {
              ok: verdict.ok,
              blocked: verdict.blocked,
              notes: verdict.notes,
              totalUsd: verdict.totalUsd,
            },
            credits: {
              used: quota.used,
              quota: quota.quota,
              remaining: quota.remaining,
            },
          },
        };
      };

      /**
       * The turn failed. Works out whether it can ever succeed, hands back the
       * credit when it cannot, and returns the reply either way.
       */
      const recover = async (aiError: any) => {
        console.error("[chat] provider failed:", aiError);
        /*
         * "Try again shortly" is only true of a failure that might pass next
         * time, and one class here never will.
         *
         * AgentRouter screens the user's own wording and answers 400
         * `content-blocked` to anything shaped like a transfer instruction
         * naming uppercase currency codes. Measured against the live gateway:
         * "swap 100 USDC to KLD", "move 100 USDC to KLD" and "100 USDC to KLD"
         * are all refused, as is "swap 100 EUR to GBP" — so the screen is about
         * money-movement phrasing, not about crypto. "exchange 100 USDC for
         * KLD" passes, every conversational question passes, and the same text
         * passes when the *assistant* says it. Retrying is futile and so is
         * switching model: the Anthropic- and OpenAI-shaped paths on that
         * gateway refuse identically.
         *
         * Which makes the honest reply an actionable one. Almost every refused
         * phrasing is a direct command `parseCommand` already owns, so it
         * resolves locally, faster, and without spending a request — naming
         * that form turns a dead end into the path that works.
         */
        const blocked = /content[-_ ]?blocked|content[-_ ]?filter/i.test(
          String(aiError?.message ?? ""),
        );
        /* A refused request never reached a model, so the allowance it was
           charged goes back. Only on this branch: a timeout or a 5xx may well
           have generated tokens upstream, and handing those back would make the
           ceiling refundable by making the provider fail. */
        const refunded = blocked
          ? await releaseModelRequest(body.address, quota)
          : null;
        return {
          response: blocked
            ? "The model gateway refused that wording — it screens messages shaped like a transfer instruction. Say it as a command, like `swap 100 USDC to KLD`, and it runs here without a reasoning request. Questions about your positions or the markets are unaffected."
            : "I couldn't complete that just now — the reasoning service returned an error. Try again shortly.",
          context: {
            status: blocked ? "provider_blocked" : "provider_error",
            /* Reported so the UI's counter follows the refund. Absent when
               there was nothing to hand back, which the client already treats
               as "leave the count alone". */
            ...(refunded ? { credits: refunded } : {}),
          },
        };
      };

      /*
       * The streamed turn.
       *
       * NDJSON, one frame per line, shape defined in src/lib/v2/chatStream.ts —
       * see that file for why a chat stream cannot just be text. It is opt-in
       * per request rather than the default so the plain JSON reply stays a
       * working client: the 429 above and the legacy proxy below both still
       * answer in it, and a caller that does not ask for frames does not get
       * them.
       *
       * The status is 200 the moment the first byte leaves, which is why the
       * quota check sits above this and not inside — a 429 has to be a real 429,
       * not an error frame inside a successful stream.
       */
      if (body.stream === true) {
        const encoder = new TextEncoder();
        let closed = false;

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (ev: ChatStreamEvent) => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
              } catch {
                /* The client went away mid-turn. Stop writing, but let the run
                   finish — it is already paid for and its reads are in flight. */
                closed = true;
              }
            };

            /* Prose since the last round boundary. A round that turns out to be
               preamble hands this over as a line of thought process instead, so
               nothing the model wrote disappears without being accounted for. */
            let round = "";

            try {
              const result = await runAgent(provider, agentInput, {
                onText: (d) => {
                  round += d;
                  send({ t: "text", d });
                },
                onReads: (reads) => {
                  const note = condenseNote(round);
                  round = "";
                  send({ t: "round", ...(note ? { note } : {}), reads });
                },
              });
              send({ t: "done", ...(await settle(result)) });
            } catch (aiError: any) {
              send({ t: "error", ...(await recover(aiError)) });
            } finally {
              if (!closed) {
                try {
                  controller.close();
                } catch {
                  /* Already closed by a cancel. */
                }
              }
            }
          },
          cancel() {
            /* The reader is gone — a closed tab, a stop button. Nothing more
               can be enqueued, and enqueueing anyway throws. */
            closed = true;
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            /* A cached or transformed stream is not a stream, and the proxy
               that would helpfully buffer this body to compress it is our own
               server: `compress: true` in next.config.mjs wraps every response
               in Next's bundled `compression` middleware, whose shouldTransform
               opts out on exactly one condition — `no-transform` in
               Cache-Control. So that token is load-bearing, not defensive.
               `x-accel-buffering` is the nginx-specific way of saying it. */
            "cache-control": "no-store, no-transform",
            "x-accel-buffering": "no",
          },
        });
      }

      try {
        return NextResponse.json(
          await settle(await runAgent(provider, agentInput)),
        );
      } catch (aiError: any) {
        return NextResponse.json(await recover(aiError));
      }
    }

    // Check if AI Engine API is available
    try {
      /* `stream` is dropped on the way through: it is a flag about how *this*
         route answers, and the engine has its own opinion about what the word
         means. Forwarding it risks asking for a body this branch then tries to
         read as JSON. */
      const { stream: _stream, ...engineBody } = body;
      // Forward the request to the AI Engine API
      const response = await fetch(`${AI_ENGINE_API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(engineBody),
        // Use configurable timeout for AI response generation
        signal: AbortSignal.timeout(AI_ENGINE_TIMEOUT),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return NextResponse.json(
          {
            error: errorData.detail || "Failed to get response from AI Engine",
          },
          { status: response.status },
        );
      }

      const data = await response.json();

      // --- ASL-4 PHASE 1: ADVERSARIAL AUDITOR PASS ---
      // This logic simulates a secondary Auditor Agent verifying the proposal.
      if (data.context?.functionData?.result) {
        const result = data.context.functionData.result;

        // 🛡️ Security Gate: Threshold Verification
        const amount = parseFloat(result.amount || "0");
        if (amount > 1000) {
          console.warn(`[Safety] Blocked high-value action: ${amount} units.`);
          return NextResponse.json({
            response:
              "I've drafted a high-value strategy, but the safety checks blocked it for your protection (Exceeds $1,000 limit). Please break your request into smaller chunks.",
            context: {
              status: "blocked_by_safety_check",
              reason: "threshold_exceeded",
            },
          });
        }

        // 🛡️ Security Gate: Omni-Chain Destination Verification
        // We validate the destination protocol against a chain-specific whitelist.
        //
        // Two deliberate choices here, both about which way this fails:
        //
        // 1. `body.chainId` only — NOT `result.chainId`. `result` is model
        //    output, so honouring it would let the model nominate the chain
        //    whose whitelist it is checked against, i.e. choose its own
        //    security policy. The wallet's connected chain is the only
        //    trustworthy source.
        // 2. No default. This used to fall back to 11124 (Abstract Testnet),
        //    which meant a request with no chain got a populated whitelist
        //    and could pass. An unknown chain must yield an EMPTY whitelist
        //    so the check below fails closed.
        const chainId: number | undefined =
          typeof body.chainId === "number" ? body.chainId : undefined;

        const MULTICHAIN_WHITELIST: Record<string, string[]> = {
          "8453": ["Base", "Aave", "Aerodrome", "Uniswap"], // Base
          "84532": ["Base", "Aave", "Aerodrome", "Uniswap"], // Base Sepolia
          "137": ["Polygon", "Aave", "Quickswap"], // Polygon
          "56": ["BSC", "Pancakeswap", "Venus", "Stargate"], // BSC
          "97": ["BSC", "Pancakeswap", "Venus", "Stargate"], // BSC Testnet
          "1": ["Ethereum", "Aave", "Uniswap", "Lido"], // Mainnet
          "11155111": ["Ethereum", "Aave", "Uniswap", "Lido"], // Sepolia
          "4663": ["Robinhood"], // Robinhood Chain
          "46630": ["Robinhood"], // Robinhood Testnet
          "5042002": ["Arc", "USDC"], // Arc Testnet
        };

        const allowedNames =
          chainId === undefined
            ? []
            : MULTICHAIN_WHITELIST[chainId.toString()] || [];
        const isWhitelisted = allowedNames.some(
          (name) =>
            result.target?.toLowerCase().includes(name.toLowerCase()) ||
            result.protocol?.toLowerCase().includes(name.toLowerCase()),
        );

        if (!isWhitelisted && result.target) {
          console.warn(
            `[Safety] Blocked unverified destination on Chain ${chainId ?? "unknown"}: ${result.target}`,
          );
          return NextResponse.json({
            response: `This transaction was blocked by safety checks. The protocol "${result.target}" is not currently whitelisted for high-security operations on Chain ID ${chainId ?? "unknown"}.`,
            context: {
              status: "blocked_by_safety_check",
              reason: "unvetted_omnichain_target",
            },
          });
        }
      }

      return NextResponse.json(data);
    } catch (fetchError: any) {
      console.error("Error connecting to AI Engine:", fetchError);

      // Return a fallback response when the AI Engine is unavailable
      return NextResponse.json({
        response:
          "I'm currently unable to connect to my backend services. Please try again later or contact support if the issue persists.",
        context: {
          conversation_id: body.conversation_id || "fallback-" + Date.now(),
        },
        error_details: {
          type: "connection_error",
          message: fetchError.message,
          cause: fetchError.cause?.code || "unknown",
        },
      });
    }
  } catch (error: any) {
    console.error("Error in chat API route:", error);
    return NextResponse.json(
      { error: error.message || "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
