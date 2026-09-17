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
} from "@/lib/ai";
import {
  runAgent,
  runAgentWithFailover,
  type AgentInput,
  type AgentRun,
} from "@/lib/ai/agent";
import { planFromToolCalls } from "@/lib/ai/fromToolCall";
import {
  getNormalizerProviders,
  isEscalation,
  normalizerAddendum,
  productFacts,
} from "@/lib/ai/normalizer";
import { serverPlanDeps } from "@/lib/ai/planDeps";
import { auditPlan, refusalText, sanitizeGuardrails } from "@/lib/ai/auditor";
import {
  consumeModelRequest,
  peekModelUsage,
  releaseModelRequest,
} from "@/lib/ai/credits";
import { condenseNote, type ChatStreamEvent } from "@/lib/v2/chatStream";
import { splitCards, splitReasoning } from "@/lib/ai/actionsBlock";
import { simulatePlan, rpcCallFor, isStaleQuoteRevert } from "@/lib/ai/simulatePlan";
import { logAgentTurn } from "@/lib/ai/turnLog";
import { checkIpRate, clientIp } from "@/lib/ai/ipRate";
import type { ChatMessage } from "@/lib/ai/types";

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
  const wallet = /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw.toLowerCase() : undefined;
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

/**
 * How many prior messages of a conversation travel to the model.
 *
 * Six, i.e. roughly three exchanges. The number is bounded for two separate
 * reasons and the smaller one decides it: cost is per-token on every round of a
 * turn, and the client controls this array, so an unbounded field is a way to
 * make one request cost as much as a hundred. Three exchanges is what the
 * observed failure needs — "use USDC" answering an offer Luca made one or two
 * turns earlier — and a conversation longer than that has usually moved on.
 */
const MAX_HISTORY_MESSAGES = 6;

/** Longest a single remembered message may be, in characters. */
const MAX_HISTORY_CHARS = 2_000;

/**
 * The conversation so far, from a request body, fit to send to a provider.
 *
 * Everything here is client input, which is the whole reason this function
 * exists rather than passing `body.history` through. It is not a trust boundary
 * in the auditor's sense — nothing in a prompt can sign anything, and the
 * auditor still checks the built plan — but three things would go wrong without
 * it: a non-array or a wrong-shaped entry would reach an adapter and throw
 * mid-turn; an unbounded array would let a caller inflate the token bill of a
 * single quota-metered request; and a role outside the two the interface names
 * would be silently reinterpreted by whichever provider received it.
 *
 * Trailing slice, not leading: the messages nearest the current one are the ones
 * it is likely to be a reply to. Empty strings drop out, because a frame-only
 * turn — a card, a plan, a receive panel with no prose — has nothing to say to a
 * model, and an empty `content` is rejected outright by some providers.
 */
function historyFromBody(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const clean: ChatMessage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const text = content.trim().slice(0, MAX_HISTORY_CHARS);
    if (!text) continue;
    clean.push({ role, content: text });
  }
  return clean.slice(-MAX_HISTORY_MESSAGES);
}

/**
 * Docs sections the client found for this question, re-checked here.
 *
 * The client sends the two closest sections so the model can answer from the
 * protocol's own text rather than reconstruct it from tool calls. It arrives
 * from a browser, so it is bounded and shaped before it is trusted: at most
 * three entries, each field a string with a hard length cap, the href a docs
 * path and nothing else. A client that sends garbage gets no grounding, not an
 * error - the turn still works, it just costs the model a read or two more.
 */
function groundingFromBody(raw: unknown): AgentInput["grounding"] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<AgentInput["grounding"]> = [];
  for (const g of raw.slice(0, 3)) {
    if (!g || typeof g !== "object") continue;
    const { title, heading, href, text } = g as Record<string, unknown>;
    if (typeof title !== "string" || typeof text !== "string" || typeof href !== "string") continue;
    if (!/^\/docs\/[a-z0-9-]+(#[a-z0-9-]+)?$/.test(href)) continue;
    out.push({
      title: title.slice(0, 80),
      heading: typeof heading === "string" ? heading.slice(0, 80) : "",
      href,
      text: text.slice(0, 900),
    });
  }
  return out.length ? out : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

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
            "You're sending requests faster than I can take them — give it a moment and try again. Direct commands like `swap 500 USDC to KLD` are unaffected.",
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
    /* The address the quota is keyed on, validated to an EIP-shaped address and
       lower-cased. Anything else is treated as no wallet — the anonymous,
       local-only branch — so a garbage string cannot become its own metered
       identity, and the counter is keyed on a canonical form rather than on
       whatever casing the caller sent. */
    const meterAddress = /^0x[0-9a-fA-F]{40}$/.test(String(body.address ?? ""))
      ? String(body.address).toLowerCase()
      : undefined;
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
          chainId:
            typeof body.chainId === "number" ? body.chainId : null,
          address: meterAddress,
        });
        return NextResponse.json(
          {
            response:
              quota.refusedBy === "anonymous"
                ? "Connect your wallet and I can work on your positions. Direct commands like `swap 500 USDC to KLD` work without it."
                : global
                  ? `The reasoning allowance shared across everyone on the testnet is spent for today — it resets at 00:00 UTC. Your own ${quota.remaining} questions are untouched and will still be there. Direct commands like \`swap 500 USDC to KLD\` work right now.`
                  : `You've asked me all ${quota.quota} questions for today. Direct commands still work, and the allowance resets at 00:00 UTC.`,
            context: {
              status: global ? "global_quota_exhausted" : "quota_exhausted",
              credits: {
                used: quota.used,
                quota: quota.quota,
                remaining: global ? quota.remaining : 0,
              },
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
      const safeLimits = sanitizeGuardrails(body.limits);

      const agentInput = {
        message: String(body.message ?? ""),
        address: meterAddress,
        chainId: body.chainId,
        limits: safeLimits,
        /* The conversation this message belongs to. Sanitised and bounded — see
           historyFromBody. Without it the model received only the sentence the
           local grammar could not parse, which on a local-first page is often a
           bare reply to something Luca itself said. */
        history: historyFromBody(body.history),
        grounding: groundingFromBody(body.grounding),
        /* The product as it is today, for the full model too — so it never
           recommends a competitor or a product that is not on this chain. The
           normalizer tier below replaces this with its fuller addendum. */
        systemAddendum: productFacts(),
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
      const settle = async (result: AgentRun, streamed = false) => {
        /* The model's card blocks — display cards and offered actions — come off
           the prose first, so every use of the reply below is the reader's
           version. Doing it here rather than at each of the three concatenations
           means a refusal, a build note and a clean answer cannot disagree about
           whether the blocks are still in. `reply.cards` is raw; the client's
           cardsFromChat validates it and forbids a `steps` receipt. */
        /* The reasoning line comes off first, before the card blocks, so what
           splitCards and every concatenation below see is prose with the model's
           private "why" already lifted out. It travels in `context.reasoning`
           and is rendered into the folded record (traceFromChat), never the
           answer — see the "Showing your reasoning" section of the system prompt. */
        const reasoned = splitReasoning(result.text);
        const reply = splitCards(reasoned.text);
        const reasoning = reasoned.reasoning;

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
        /* Everything the user themselves typed this turn — this message plus
           their earlier turns — so the planner can refuse to send to or delegate
           to an address the user never named. An address a tool result or a
           document slipped in is not in here. */
        const userText = [
          agentInput.message,
          ...agentInput.history
            .filter((m) => m.role === "user")
            .map((m) => m.content),
        ].join("\n");

        /*
         * Build then audit, inside one try — because a throw HERE is ours, not
         * the model's. The model answered; it is the builder or the auditor that
         * failed. Letting it propagate sent it to `recover`, which tags it
         * `provider_error` and puts "the model is unavailable" underneath a reply
         * the model produced perfectly well. So this branch keeps the prose,
         * reports a distinct `build_error`, and logs it under its own prefix, so a
         * builder bug is triaged as a builder bug rather than a model outage.
         *
         * (What each does: the builder fills in contract addresses, decimals, fee
         * tiers, quotes and slippage floors from the registry and chain reads, the
         * same way the typed path does; the auditor then verifies the BUILT plan —
         * real addresses, real amountOutMin values — and drops a rejected plan
         * whole, never trimmed to its passing steps, since the steps are ordered
         * and interdependent. `limits`/`allowedActions` are client input, treated
         * as tightening-only.)
         */
        let built: Awaited<ReturnType<typeof planFromToolCalls>>;
        let verdict: Awaited<ReturnType<typeof auditPlan>>;
        try {
          built = await planFromToolCalls(
            result.executes,
            chainId,
            serverPlanDeps(body.address, chainId),
            {
              slippageBps: safeLimits.slippageBps,
              deadlineMin: 20,
            },
            userText,
          );
          verdict = await auditPlan({
            plan: built.plan,
            chainId,
            limits: safeLimits,
            allowedActions: body.limits?.allowedActions,
          });
        } catch (buildErr) {
          console.error("[chat] plan build/audit failed:", buildErr);
          await logAgentTurn({
            status: "build_error",
            provider: result.provider,
            model: result.model,
            latencyMs: Date.now() - startedAt,
            failedOver: !!provider && result.provider !== provider.id,
            rounds: result.rounds,
            readCount: result.trace.length,
            stream: streamed,
            chainId,
            address: meterAddress,
            error: String(
              (buildErr as { name?: string })?.name ?? "build_error",
            ).slice(0, 60),
          });
          return {
            response: `${reply.text}\n\n---\n\nI worked that out, but couldn't prepare the steps to sign — try again, or use a direct command like \`swap 500 USDC to KLD\`.`,
            context: {
              status: "build_error",
              provider: result.provider,
              model: result.model,
              ...(reply.cards.length ? { cards: reply.cards } : {}),
              ...(reasoning ? { reasoning } : {}),
              reads: result.trace,
              credits: {
                used: quota.used,
                quota: quota.quota,
                remaining: quota.remaining,
              },
            },
          };
        }

        if (!verdict.ok) {
          console.warn(
            "[chat] auditor rejected plan:",
            JSON.stringify(verdict.blocked),
          );
        }

        /*
         * Simulate the built plan against the current block before offering it as
         * signable — the propose-time counterpart to the sign-time preflight
         * (withPreflight). It fakes each approve into the step it authorises and
         * eth_calls the plan, so a first-time swap whose floor the market has moved
         * past is called out here rather than at the wallet.
         *
         * Only when the auditor PASSED a plan we have a wallet to simulate from.
         * Bounded by a race so a slow or unreachable RPC cannot hold the turn.
         * Surface only, with one deterministic exception (the stale-quote retry
         * below): a predicted revert is stated, the plan still offered — the market
         * may move again by signing, and the preflight re-checks against real state
         * then — and anything short of a decoded, honoured revert says nothing.
         */
        let simNote = "";
        if (
          verdict.ok &&
          built.plan.length > 0 &&
          meterAddress &&
          chainId !== undefined
        ) {
          const rpc = rpcCallFor(chainId);
          const from = meterAddress;
          if (rpc) {
            /* One bounded simulation of a plan. The cast is the PlanStep↔Intent
               identity the wire already relies on (intentsFromChat); the race caps
               it so the RPC can never hold the turn. */
            const simOnce = (plan: typeof built.plan) =>
              Promise.race([
                simulatePlan(
                  plan as unknown as Parameters<typeof simulatePlan>[0],
                  chainId,
                  from,
                  rpc,
                ),
                new Promise<null>((r) => setTimeout(() => r(null), 5000)),
              ]);

            try {
              let sim = await simOnce(built.plan);

              /* A slippage-floor revert is very often a quote that went stale in the
                 beat between pricing and simulating: the pool moved and the same plan
                 re-priced now would clear. On exactly that reason, rebuild ONCE with a
                 fresh quote — which re-audits like any built plan — and re-simulate.
                 No model call and no new quota: deterministic self-correction, bounded
                 to a single retry. A second failure is surfaced, never chased. */
              if (
                sim &&
                !sim.ok &&
                sim.firstFailure &&
                isStaleQuoteRevert(sim.firstFailure.reason)
              ) {
                try {
                  const rebuilt = await planFromToolCalls(
                    result.executes,
                    chainId,
                    serverPlanDeps(body.address, chainId),
                    { slippageBps: safeLimits.slippageBps, deadlineMin: 20 },
                    userText,
                  );
                  if (rebuilt.plan.length > 0) {
                    const reverdict = await auditPlan({
                      plan: rebuilt.plan,
                      chainId,
                      limits: safeLimits,
                      allowedActions: body.limits?.allowedActions,
                    });
                    if (reverdict.ok) {
                      const resim = await simOnce(rebuilt.plan);
                      if (resim && resim.ok) {
                        /* The fresh quote clears it — offer the re-priced plan, and
                           say so rather than pretending nothing was wrong. */
                        built = rebuilt;
                        verdict = reverdict;
                        sim = resim;
                        simNote =
                          "\n\n---\n\nThe first pricing would have slipped past your limit, so I re-priced it against the current market before offering it.";
                      }
                    }
                  }
                } catch {
                  /* Fail open — keep the original plan and surface the prediction. */
                }
              }

              /* Still predicted to revert — not a stale quote, or the re-price did
                 not clear it. State it, keep the plan, let the preflight and the user
                 take it from here. */
              if (sim && !sim.ok && sim.firstFailure) {
                const f = sim.firstFailure;
                const where =
                  built.plan.length > 1 ? `step ${f.index + 1}` : "this";
                simNote =
                  `\n\n---\n\nI simulated it against the chain as it stands and ${where} looks like it would revert` +
                  (f.reason ? ` — ${f.reason}` : "") +
                  `. The market may move again before you sign, so I've still prepared it and I re-check each step at signing; or ask me to rebuild it.`;
              }
            } catch {
              /* Fail open — a simulation that throws is no reason to hold a plan. */
            }
          }
        }

        /* A verb that couldn't be built is reported, not swallowed. Computed after
           the simulation because a stale-quote retry above can replace `built` with
           a freshly-priced plan, and these notes must describe the plan actually
           offered — not the one the retry discarded. */
        const buildNotes = built.errors.length
          ? `\n\n---\n\nI couldn't prepare some of that:\n${built.errors.map((e) => `• ${e}`).join("\n")}`
          : "";

        /* The record of a turn that ran. `refused` is a turn the model answered
           and the auditor then dropped its plan — a different fact from a clean
           answer, and one worth being able to count. failed_over is the outage
           signal: the answer came from a backend other than the primary. */
        await logAgentTurn({
          status: verdict.ok ? "ok" : "refused",
          provider: result.provider,
          model: result.model,
          latencyMs: Date.now() - startedAt,
          failedOver: !!provider && result.provider !== provider.id,
          planSteps: verdict.ok ? built.plan.length : 0,
          auditOk: built.plan.length > 0 ? verdict.ok : null,
          /* How hard the turn worked, not just how it ended: the grounding passes
             the loop ran and the reads they made. */
          rounds: result.rounds,
          readCount: result.trace.length,
          stream: streamed,
          chainId,
          address: meterAddress,
        });

        return {
          response: verdict.ok
            ? `${reply.text}${buildNotes}${simNote}`
            : /* The model's own words, then the refusal. Dropping the prose
                 would hide the analysis the user paid a request for. */
              `${reply.text}${buildNotes}\n\n---\n\n${refusalText(verdict)}`,
          context: {
            plan: verdict.ok ? built.plan : [],
            provider: result.provider,
            model: result.model,
            /* The cards the answer carried — display cards and any offered
               actions. Sent unvalidated on purpose: `cardsFromChat` on the client
               is the gate every card passes through, local or model, and it is
               where the caps, the rebuild and the `steps` ban live; a second
               half-implementation here would be a second thing to keep in step
               with it. Omitted rather than sent empty, so a reply that carried
               nothing does not imply it might have. */
            ...(reply.cards.length ? { cards: reply.cards } : {}),
            /* The distilled "why" behind this answer, when the model offered one.
               Rendered as the lead line of the folded record (traceFromChat), not
               the prose — so a turn's reasoning sits with the reads it made rather
               than in the answer the reads produced. Omitted when the model wrote
               none, which is the common case. */
            ...(reasoning ? { reasoning } : {}),
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
      const recover = async (aiError: any, streamed = false) => {
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
          ? await releaseModelRequest(meterAddress, quota)
          : null;

        /* A failed turn, with a short error class rather than the raw message —
           enough to tell a gateway content-block from a 5xx or a timeout when
           reading the log, never a user's words. */
        await logAgentTurn({
          status: blocked ? "provider_blocked" : "provider_error",
          provider: provider?.id ?? null,
          latencyMs: Date.now() - startedAt,
          stream: streamed,
          chainId,
          address: meterAddress,
          error: String(aiError?.name ?? aiError?.code ?? "error").slice(0, 60),
        });

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
              systemAddendum: normalizerAddendum({ chainId }),
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
              const result = await runAgentWithFailover(providers, agentInput, {
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
          await settle(await runAgentWithFailover(providers, agentInput)),
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
          /* Tagged like the provider-error branch above, so the client can
             answer from the docs instead of showing this sentence. Without
             the tag, a network failure to the engine reached the user as a
             bare apology while a provider 5xx got the graceful path. */
          status: "provider_error",
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
