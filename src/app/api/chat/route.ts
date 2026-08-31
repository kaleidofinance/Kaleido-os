import { NextRequest, NextResponse } from "next/server";
import {
  getProvider,
  isRouterModel,
  ROUTER_MODELS,
  ROUTER_MODEL_IDS,
} from "@/lib/ai";
import { runAgent } from "@/lib/ai/agent";
import { planFromToolCalls } from "@/lib/ai/fromToolCall";
import { serverPlanDeps } from "@/lib/ai/planDeps";
import { auditPlan, refusalText } from "@/lib/ai/auditor";
import { consumeModelRequest, peekModelUsage } from "@/lib/ai/credits";

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

      try {
        const result = await runAgent(provider, {
          message: String(body.message ?? ""),
          address: body.address,
          chainId: body.chainId,
          limits: body.limits,
        });

        /*
         * Verbs become intents here, before anything is audited.
         *
         * The model chose a verb and the arguments the user actually stated;
         * this is where contract addresses, decimals, fee tiers, quotes and
         * slippage floors get filled in — from the registry and from chain
         * reads, through the same builder the typed-command path uses. Doing
         * it at the route rather than in each provider adapter means one
         * translation, not one per provider.
         *
         * `chainId` goes to all three of planFromToolCalls, serverPlanDeps and
         * auditPlan below, and it has to be the same value in all three or the
         * plan mixes chains: token symbols resolve here, contract addresses
         * resolve in the deps, and the pins are checked in the auditor.
         */
        const chainId =
          typeof body.chainId === "number" ? body.chainId : undefined;
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

        return NextResponse.json({
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
               this route can state as fact — the reply is one non-streaming
               call, so there is no chain of thought to forward, but which
               questions it asked about the chain is a matter of record.

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
        });
      } catch (aiError: any) {
        console.error("[chat] provider failed:", aiError);
        return NextResponse.json({
          response:
            "I couldn't complete that just now — the reasoning service returned an error. Try again shortly.",
          context: { status: "provider_error" },
        });
      }
    }

    // Check if AI Engine API is available
    try {
      // Forward the request to the AI Engine API
      const response = await fetch(`${AI_ENGINE_API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
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
