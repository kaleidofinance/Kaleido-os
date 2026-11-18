import { NextRequest, NextResponse } from "next/server";
import {
  getProvider,
  getProviderChain,
  isSelectableModel,
  ROUTER_MODELS,
  ROUTER_MODEL_IDS,
  GEMINI_MODELS,
  GEMINI_MODEL_IDS,
  GATEWAY_MODELS,
  GATEWAY_MODEL_IDS,
  OLLAMA_MODELS,
  OLLAMA_MODEL_IDS,
} from "@/lib/ai";
import {
  runAgent,
  type AgentRun,
} from "@/lib/ai/agent";
import {
  recoverAgentTurn,
  runTurn,
  settleAgentTurn,
} from "@/lib/ai/turnRunner";
import {
  getNormalizerProviders,
  isEscalation,
  normalizerAddendum,
} from "@/lib/ai/normalizer";
import {
  classifyLucaRoute,
  jevMode,
  jevReplaceMinConfidence,
  shouldSkipNormalizer,
  type JevRoute,
} from "@/lib/ai/jev";
import {
  consumeModelRequest,
  peekModelUsage,
} from "@/lib/ai/credits";
import { condenseNote, type ChatStreamEvent } from "@/lib/v2/chatStream";
import { logAgentTurn } from "@/lib/ai/turnLog";
import { checkIpRate, clientIp } from "@/lib/ai/ipRate";
import { chainTokens } from "@/constants/tokens";
import { launchpadAnswer } from "@/lib/ai/localProtocolAnswer";
import { walletChainContext } from "@/lib/ai/walletContext";
import { createTurnContext, turnContextError } from "@/lib/ai/turnContext";
import { getCapabilitySnapshot } from "@/lib/ai/capabilities";
import { createAgentInput } from "@/lib/ai/turnCoordinator";
import { canUseLocalCatalog } from "@/lib/ai/intentRouter";
import { resolveQuotaIdentity } from "@/lib/ai/quotaIdentity";
import { guardLegacyPlan, legacyEngineRequest } from "@/lib/ai/legacyEngine";

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
  /* Validated to an address shape: a peek is a low-sensitivity read (a daily
     count), but a malformed value should not reach the RPC, and an unowned one
     gets the same empty default as no wallet. Proving ownership of the address
     is the session-auth work deferred with the provider decision. */
  const raw = request.nextUrl.searchParams.get("address") ?? "";
  const wallet = /^0x[0-9a-fA-F]{40}$/.test(raw)
    ? raw.toLowerCase()
    : undefined;
  const usage = await peekModelUsage(wallet);
  const models = [
    ...(process.env.AGENTROUTER_API_KEY
      ? ROUTER_MODEL_IDS.map((id) => ({ id, label: ROUTER_MODELS[id].label }))
      : []),
    ...(process.env.GEMINI_API_KEY
      ? GEMINI_MODEL_IDS.map((id) => ({ id, label: GEMINI_MODELS[id].label }))
      : []),
    ...(process.env.AI_GATEWAY_API_KEY
      ? GATEWAY_MODEL_IDS.map((id) => ({ id, label: GATEWAY_MODELS[id].label }))
      : []),
    ...(process.env.OLLAMA_API_KEY
      ? OLLAMA_MODEL_IDS.map((id) => ({ id, label: OLLAMA_MODELS[id].label }))
      : []),
  ];
  return NextResponse.json({
    provider: Boolean(getProvider()),
    models,
    defaultModel:
      process.env.AI_PROVIDER === "gateway" ||
      process.env.AI_PROVIDER === "ai-gateway"
        ? (process.env.AI_GATEWAY_MODEL ?? "openai/gpt-5")
        : process.env.AI_PROVIDER === "gemini"
          ? (process.env.GEMINI_MODEL ?? "gemini-flash-latest")
          : process.env.AI_PROVIDER === "ollama" ||
              (!process.env.AI_PROVIDER && process.env.OLLAMA_API_KEY)
            ? (process.env.OLLAMA_MODEL ?? "gemma4:31b")
            : (process.env.AGENTROUTER_MODEL ?? null),
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

    /*
     * Establish one immutable scope for this turn before quota/provider work.
     * Chain, mode, wallet identity, and request id are validated together so
     * no downstream branch can accidentally fall back to a different chain or
     * treat a mainnet request as a testnet request.
     */
    const turn = createTurnContext({
      address: body?.address,
      chainId: body?.chainId,
      showTestnets: body?.showTestnets,
      requestId: body?.requestId,
    });
    const scopeError = turnContextError(turn);
    if (scopeError) {
      return NextResponse.json(
        {
          response: scopeError,
          context: {
            status: "invalid_turn_scope",
            requestId: turn.requestId,
            networkMode: turn.networkMode,
            chainId: turn.requestedChainId ?? null,
            chainStatus: turn.chainStatus,
          },
        },
        { status: 400 },
      );
    }

    const { chainId, mainnetOnly, networkMode } = turn;
    const capabilities = getCapabilitySnapshot({ chainId, networkMode });

    /* Keep this verified protocol fact local even for API callers that do not
       use the browser's local-first dispatcher. It prevents the legacy engine
       or a stale docs index from answering that Kaleido has no launchpad
       integrations, while launch/deploy actions still continue to the planner
       and auditor. */
    const message = String(body.message ?? "");
    const localLaunchpadAnswer = canUseLocalCatalog(message)
      ? launchpadAnswer(message, {
          chainId,
          showTestnets: networkMode === "testnet",
        })
      : null;
    if (localLaunchpadAnswer) {
      return NextResponse.json({
        response: localLaunchpadAnswer,
        context: {
          status: "local_protocol_catalog",
          requestId: turn.requestId,
          capabilities,
        },
      });
    }

    /*
     * Per-IP rate limit, before anything else spends work or quota.
     *
     * The quota below is keyed on a wallet address the caller supplies and does
     * not have to own, so on its own it lets a script POST a victim's address to
     * lock them out, or rotate addresses to burn the shared daily ceiling for
     * everyone. This is the floor that raises the cost of both: one IP cannot
     * hammer the endpoint regardless of what identity it claims. It fails open
     * (a limiter outage must not take the agent down) and sits in front of the
     * per-wallet and deployment caps, not instead of them. Not a substitute for
     * binding the quota to a signed session — that is the stronger fix, deferred
     * with the wallet-provider decision — but it closes the cheap attacks now.
     */
    const ipRate = await checkIpRate(clientIp(request.headers));
    if (!ipRate.allowed) {
      return NextResponse.json(
        {
          response:
            "You're sending requests faster than I can take them — give it a moment and try again. Direct commands like `swap 500 USDC to EURC` are unaffected.",
          context: { status: "rate_limited" },
        },
        { status: 429 },
      );
    }

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
      typeof body.model === "string" && isSelectableModel(body.model)
        ? body.model
        : undefined;
    /* Primary provider, then the others as fall-backs, so a model outage on
       one backend degrades to the next instead of failing the turn. */
    /* The page asks for the normalizer tier on every sentence its local nets
       could not answer: a cheap single-shot read before the full model — see
       lib/ai/normalizer.ts. Anything else is the full turn as before. */
    const tier = body.tier === "normalize" ? "normalize" : "full";
    const providers = getProviderChain(requested);
    const provider = providers[0] ?? null;
    /* When the turn started, for the latency every ending records. */
    const startedAt = Date.now();
    let jevRoute: JevRoute | null = null;
    let jevConfidence: number | null = null;
    let jevNormalizerSkipped = false;
    /* The address the quota is keyed on, validated to an EIP-shaped address and
       lower-cased. Anything else is treated as no wallet — the anonymous,
       local-only branch — so a garbage string cannot become its own metered
       identity, and the counter is keyed on a canonical form rather than on
       whatever casing the caller sent. */
    const quotaIdentity = await resolveQuotaIdentity({
      address: body.address,
      signature: body.quotaSignature,
      signedAt: body.quotaSignedAt,
    });
    if (quotaIdentity.error) {
      return NextResponse.json(
        { response: quotaIdentity.error, context: { status: "invalid_quota_session" } },
        { status: 401 },
      );
    }
    const meterAddress = quotaIdentity.address ?? turn.address;
    if (provider) {
      // Quota is spent here, at the point of dispatch, and nowhere earlier.
      // A turn the client answered locally never reaches this route at all, so
      // routing locally first is what makes the allowance go far.
      const quota = await consumeModelRequest(meterAddress);
      if (!quota.allowed) {
        /*
         * Three refusals, three different things to say, and the difference
         * matters. Telling someone the shared allowance ran out when in fact
         * they have used their own 25 sends them back to try again in ten
         * minutes; telling someone they have used all 25 of theirs when they
         * have asked two questions is simply false, and it sends them away for
         * the day. `refusedBy` is what the ceiling itself reported, so the two
         * cannot drift the way re-deriving them here from `body.address` could.
         *
         * On the shared refusal the wallet's own counter was rolled back inside
         * the same transaction, so `remaining` is real and is passed through
         * rather than zeroed — the credits pill in the UI reads this field, and
         * it should not show a user as spent when they are not.
         */
        const global = quota.refusedBy === "global";
        /* A refused turn is still a turn worth counting — an exhausted global cap
           is an operational event (the shared allowance ran dry), distinct from a
           per-wallet or anonymous refusal. No provider ran, so no provider/model. */
        await logAgentTurn({
          status:
            quota.refusedBy === "global"
              ? "global_quota_exhausted"
              : quota.refusedBy === "anonymous"
                ? "quota_anonymous"
                : "quota_exhausted",
          latencyMs: Date.now() - startedAt,
          chainId: chainId ?? null,
          address: meterAddress,
        });
        return NextResponse.json(
          {
            response:
              quota.refusedBy === "anonymous"
                ? "Connect your wallet and I can work on your positions. Direct commands like `swap 500 USDC to EURC` work without it."
                : global
                  ? `The shared reasoning allowance is spent for today — it resets at 00:00 UTC. Your own ${quota.remaining} questions are untouched and will still be there. Direct commands like \`swap 500 USDC to EURC\` work right now.`
                  : `You've asked me all ${quota.quota} questions for today. Direct commands still work, and the allowance resets at 00:00 UTC.`,
            context: {
              status: global ? "global_quota_exhausted" : "quota_exhausted",
              credits: {
                used: quota.used,
                quota: quota.quota,
                remaining: global ? quota.remaining : 0,
              },
              capabilities,
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
      /*
       * Client limits are untrusted input, and they reach three places: the
       * auditor (which treats them as tightening-only), the planner's slippage
       * floor, and the model prompt. Sanitise once, here, so a non-numeric value
       * cannot pass through as NaN — Math.min(NaN, cap) is NaN and `stepUsd > NaN`
       * is always false, which silently disabled the very ceiling the auditor
       * calls the one the client cannot raise. A bad field becomes undefined (the
       * auditor then applies its own ceiling), and slippage is clamped into a sane
       * band so a client cannot post a 100% tolerance that drives amountOutMin to
       * ~0. allowedActions is passed on untouched — it is the user's product
       * switches, enforced separately.
       */
      /* One sanitiser for both audit entry points — see sanitizeGuardrails. The
         locally-built plan path (/api/audit) cleans limits the same way, so a
         typed command and a reasoned one are held to the same ceiling. */
      /* Testnets are hidden by default in the UI (mainnet-first). The page
         sends the flag; absent reads as mainnet-only, so an older client or a
         direct call is held to the same posture. Threads to the read tools
         (no testnet balance surfaced) and the system facts (no testnet
         steering). */
      const agentInput = createAgentInput(body, turn, capabilities);
      const safeLimits = agentInput.limits as { slippageBps: number };
      const userText = [
        agentInput.message,
        ...(agentInput.history ?? [])
          .filter((m) => m.role === "user")
          .map((m) => m.content),
      ].join("\n");

      const settle = (result: AgentRun, streamed = false) =>
        settleAgentTurn({
          result,
          streamed,
          chainId,
          meterAddress,
          userText,
          safeLimits,
          allowedActions: body.limits?.allowedActions,
          primaryProvider: provider,
          quota,
          capabilities,
          startedAt,
          requestId: turn.requestId,
          jev: {
            route: jevRoute,
            confidence: jevConfidence,
            normalizerSkipped: jevNormalizerSkipped,
          },
        });

      const recover = (aiError: unknown, streamed = false) =>
        recoverAgentTurn({
          aiError,
          streamed,
          primaryProvider: provider,
          chainId,
          meterAddress,
          quota,
          capabilities,
          startedAt,
          requestId: turn.requestId,
          jev: {
            route: jevRoute,
            confidence: jevConfidence,
            normalizerSkipped: jevNormalizerSkipped,
          },
        });

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
      /*
       * THE NORMALIZER TIER.
       *
       * One cheap, single-shot call (no read rounds) with the product facts and
       * the dialect glossary in its prompt. Three outcomes:
       *  - it made an execute call → settled exactly like a full turn, through
       *    planFromToolCalls and the auditor, so a cheap model's proposal is held
       *    to the same checks as an expensive one's;
       *  - it answered a question in prose → settled and returned;
       *  - it said ESCALATE, said nothing, or the plan could not be built →
       *    fall through to the full turn below, on the same already-consumed
       *    credit, so one sentence never costs two.
       * Skipped entirely when no cheap model is configured. Returned as plain
       * JSON even to a streaming client: the client's JSON branch renders a
       * plan, cards and credits identically, and a one-round answer has nothing
       * to stream.
       */
      if (tier === "normalize") {
        const jev = await classifyLucaRoute({
          message: body.message,
          chainId,
          walletConnected: Boolean(meterAddress),
          mainnetOnly,
          visibleTokens: chainTokens(chainId).map((token) => token.symbol),
        });
        if (jev) {
          jevRoute = jev.route;
          jevConfidence = jev.confidence;
          console.info("[chat] Jev route:", {
            mode: jevMode(),
            route: jev.route,
            confidence: jev.confidence,
          });
        }

        /* In replace mode, Jev can skip the redundant cheap text model when it
           already identifies a live-data or reasoning request. The full agent
           still owns reads, tools, prose, auditing, and execution. Shadow mode
           records the decision but preserves today's behavior for calibration. */
        const skipNormalizer = shouldSkipNormalizer({
          mode: jevMode(),
          route: jev?.route ?? null,
          confidence: jev?.confidence ?? null,
          minimum: jevReplaceMinConfidence(),
        });
        jevNormalizerSkipped = skipNormalizer;
        if (skipNormalizer) {
          // Continue directly to the existing full-agent path below.
        } else {
          /* Each configured cheap model in turn. A THROWN error (a 503, a
           timeout) moves to the next cheap model — that is what the second one
           is for. A considered decline — ESCALATE, an empty reply, a plan that
           would not build — goes straight to the full model: the sentence was
           read and judged, and a second cheap opinion is not worth a call. */
          for (const cheap of getNormalizerProviders()) {
            try {
              const quick = await runAgent(cheap, {
                ...agentInput,
                maxReadRounds: 0,
                systemAddendum: `${normalizerAddendum({ chainId, mainnetOnly })}\n${walletChainContext(chainId)}`,
              });
              const bail =
                quick.executes.length === 0 &&
                (isEscalation(quick.text, 0) || !quick.text.trim());
              if (bail) break;
              const settled = (await settle(quick)) as {
                response: string;
                context?: Record<string, unknown>;
              };
              if (settled.context?.status === "build_error") break;
              return NextResponse.json({
                ...settled,
                context: { ...(settled.context ?? {}), tier: "normalize" },
              });
            } catch (quickError) {
              console.warn(
                `[chat] normalizer ${cheap.id}/${cheap.model} failed, trying next:`,
                quickError,
              );
            }
          }
        }
      }

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
              const result = await runTurn({ providers, input: agentInput, events: {
                onText: (d) => {
                  round += d;
                  send({ t: "text", d });
                },
                onReads: (reads) => {
                  const note = condenseNote(round);
                  round = "";
                  send({ t: "round", ...(note ? { note } : {}), reads });
                },
              } });
              send({ t: "done", ...(await settle(result, true)) });
            } catch (aiError: any) {
              send({ t: "error", ...(await recover(aiError, true)) });
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
          await settle(await runTurn({ providers, input: agentInput })),
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
      const scopedEngineBody = {
        ...engineBody,
        address: meterAddress,
        ...(chainId !== undefined ? { chainId } : {}),
        showTestnets: networkMode === "testnet",
        networkMode,
        requestId: turn.requestId,
        capabilities,
      };
      // Forward the request to the AI Engine API
      const response = await legacyEngineRequest({
        url: AI_ENGINE_API_URL,
        body: scopedEngineBody,
        timeoutMs: AI_ENGINE_TIMEOUT,
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

      const guard = guardLegacyPlan(data, { chainId });
      if (guard.blocked) {
        return NextResponse.json({
          response: guard.response,
          context: guard.context,
        });
      }

      return NextResponse.json({
        ...data,
        context: {
          ...(data.context ?? {}),
          requestId: turn.requestId,
          capabilities,
        },
      });
    } catch (fetchError: any) {
      console.error("Error connecting to AI Engine:", fetchError);

      // Return a fallback response when the AI Engine is unavailable
      return NextResponse.json({
        response:
          "I'm currently unable to connect to my backend services. Please try again later or contact support if the issue persists.",
        context: {
          /* Tagged like the provider-error branch above, so the client can
             answer from the docs instead of showing this sentence. Without
             the tag, a network failure to the engine reached the user as a
             bare apology while a provider 5xx got the graceful path. */
          status: "provider_error",
          requestId: turn.requestId,
          capabilities,
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
