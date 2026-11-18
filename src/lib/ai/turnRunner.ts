import {
  runAgentWithFailover,
  type AgentEvents,
  type AgentInput,
  type AgentRun,
} from "./agent";
import { splitCards, splitReasoning } from "./actionsBlock";
import { auditPlan, refusalText } from "./auditor";
import type { CapabilitySnapshot } from "./capabilities";
import { releaseModelRequest } from "./credits";
import { planFromToolCalls } from "./fromToolCall";
import type { JevRoute } from "./jev";
import { serverPlanDeps } from "./planDeps";
import {
  isStaleQuoteRevert,
  rpcCallFor,
  simulatePlan,
} from "./simulatePlan";
import { logAgentTurn } from "./turnLog";
import { classifyTurn, type TurnPlanState, type TurnResult } from "./turnResult";
import type { ChatProvider } from "./types";

/** Dependencies owned by the server route for one model turn. */
export interface TurnRunnerInput {
  providers: readonly ChatProvider[];
  input: AgentInput;
  events?: AgentEvents;
}

/**
 * The single provider/runtime seam for Luca turns.
 *
 * Route code should not call a provider directly. This keeps provider ordering,
 * retries, streaming stall detection, and the bounded agent loop behind one
 * contract while preserving the existing deterministic plan/audit boundary.
 */
export async function runTurn({
  providers,
  input,
  events,
}: TurnRunnerInput): Promise<AgentRun> {
  const chain = providers.filter(Boolean);
  if (chain.length === 0) throw new Error("No model provider configured.");
  return runAgentWithFailover([...chain], input, events);
}

export interface SettleTurnArgs {
  result: AgentRun;
  streamed?: boolean;
  chainId?: number;
  meterAddress?: string;
  userText: string;
  safeLimits: { slippageBps: number } & Record<string, unknown>;
  allowedActions?: unknown;
  primaryProvider?: ChatProvider | null;
  quota: { used: number; quota: number; remaining: number };
  capabilities: CapabilitySnapshot;
  startedAt: number;
  requestId: string;
  jev?: {
    route: JevRoute | null;
    confidence: number | null;
    normalizerSkipped: boolean;
  };
}

export interface SettledTurnResponse {
  response: string;
  context: Record<string, unknown>;
  outcome: TurnResult;
}

export async function settleAgentTurn(
  args: SettleTurnArgs,
): Promise<SettledTurnResponse> {
  const {
    result,
    streamed = false,
    chainId,
    meterAddress,
    userText,
    safeLimits,
    allowedActions,
    primaryProvider,
    quota,
    capabilities,
    startedAt,
    requestId,
    jev,
  } = args;

  const reasoned = splitReasoning(result.text);
  const reply = splitCards(reasoned.text);
  const reasoning = reasoned.reasoning;
  const failedOver = Boolean(
    primaryProvider && result.provider !== primaryProvider.id,
  );
  const fallbackNote = failedOver
    ? `\n\n---\n\nNote: ${primaryProvider?.model ?? "the primary model"} was unavailable, so ${result.model} answered this turn.`
    : "";

  let built: Awaited<ReturnType<typeof planFromToolCalls>>;
  let verdict: Awaited<ReturnType<typeof auditPlan>>;
  try {
    built = await planFromToolCalls(
      result.executes,
      chainId,
      serverPlanDeps(meterAddress, chainId),
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
      allowedActions: allowedActions as Parameters<typeof auditPlan>[0]["allowedActions"],
    });
  } catch (buildErr) {
    console.error("[chat] plan build/audit failed:", buildErr);
    await logAgentTurn({
      status: "build_error",
      provider: result.provider,
      model: result.model,
      latencyMs: Date.now() - startedAt,
      failedOver,
      rounds: result.rounds,
      readCount: result.trace.length,
      stream: streamed,
      chainId,
      address: meterAddress,
      jevRoute: jev?.route ?? null,
      jevConfidence: jev?.confidence ?? null,
      jevNormalizerSkipped: jev?.normalizerSkipped ?? false,
      error: String((buildErr as { name?: string })?.name ?? "build_error").slice(
        0,
        60,
      ),
    });
    const outcome = classifyTurn(result, {
      kind: "unavailable",
      reason: "build_error",
      retryable: true,
    });
    return {
      response: `${reply.text}${fallbackNote}\n\n---\n\nI worked that out, but couldn't prepare the steps to sign — try again, or use a direct command like \`swap 500 USDC to EURC\`.`,
      context: {
        status: "build_error",
        requestId,
        outcome: outcome.kind,
        provider: result.provider,
        model: result.model,
        failedOver,
        ...(reply.cards.length ? { cards: reply.cards } : {}),
        ...(reasoning ? { reasoning } : {}),
        reads: result.trace,
        credits: {
          used: quota.used,
          quota: quota.quota,
          remaining: quota.remaining,
        },
        capabilities,
      },
      outcome,
    };
  }

  if (!verdict.ok) {
    console.warn(
      "[chat] auditor rejected plan:",
      JSON.stringify(verdict.blocked),
    );
  }

  let simNote = "";
  let simState: TurnPlanState["simulation"] = "not_run";
  if (
    verdict.ok &&
    built.plan.length > 0 &&
    meterAddress &&
    chainId !== undefined
  ) {
    const rpc = rpcCallFor(chainId);
    const from = meterAddress;
    if (rpc) {
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
              serverPlanDeps(meterAddress, chainId),
              { slippageBps: safeLimits.slippageBps, deadlineMin: 20 },
              userText,
            );
            if (rebuilt.plan.length > 0) {
              const reverdict = await auditPlan({
                plan: rebuilt.plan,
                chainId,
                limits: safeLimits,
                allowedActions: allowedActions as Parameters<
                  typeof auditPlan
                >[0]["allowedActions"],
              });
              if (reverdict.ok) {
                const resim = await simOnce(rebuilt.plan);
                if (resim && resim.ok) {
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

        if (sim === null) {
          simState = "unavailable";
        } else if (sim.ok) {
          simState = "passed";
        } else if (sim.firstFailure) {
          simState = "failed";
          const f = sim.firstFailure;
          const where =
            built.plan.length > 1 ? `step ${f.index + 1}` : "this";
          simNote =
            `\n\n---\n\nI simulated it against the chain as it stands and ${where} looks like it would revert` +
            (f.reason ? ` — ${f.reason}` : "") +
            `. The market may move again before you sign, so I've still prepared it and I re-check each step at signing; or ask me to rebuild it.`;
        } else {
          simState = "unavailable";
        }
      } catch {
        simState = "unavailable";
      }
    } else {
      simState = "unavailable";
    }
  }

  const buildNotes = built.errors.length
    ? `\n\n---\n\nI couldn't prepare some of that:\n${built.errors.map((e) => `• ${e}`).join("\n")}`
    : "";

  await logAgentTurn({
    status: verdict.ok ? "ok" : "refused",
    provider: result.provider,
    model: result.model,
    latencyMs: Date.now() - startedAt,
    failedOver,
    planSteps: verdict.ok ? built.plan.length : 0,
    auditOk: built.plan.length > 0 ? verdict.ok : null,
    rounds: result.rounds,
    readCount: result.trace.length,
    stream: streamed,
    chainId,
    address: meterAddress,
    jevRoute: jev?.route ?? null,
    jevConfidence: jev?.confidence ?? null,
    jevNormalizerSkipped: jev?.normalizerSkipped ?? false,
  });

  const hasPlan = verdict.ok && built.plan.length > 0;
  const outcome = !verdict.ok
    ? classifyTurn(result, { kind: "refusal", reason: "audit_rejected" })
    : hasPlan
      ? classifyTurn(result, {
          kind: "plan",
          plan: { audit: "passed", simulation: simState },
        })
      : classifyTurn(result, { kind: "answer" });

  return {
    response: verdict.ok
      ? `${reply.text}${fallbackNote}${buildNotes}${simNote}`
      : `${reply.text}${fallbackNote}${buildNotes}\n\n---\n\n${refusalText(verdict)}`,
    context: {
      plan: verdict.ok ? built.plan : [],
      requestId,
      outcome: outcome.kind,
      provider: result.provider,
      model: result.model,
      failedOver,
      ...(reply.cards.length ? { cards: reply.cards } : {}),
      ...(reasoning ? { reasoning } : {}),
      reads: result.trace,
      audit: {
        ok: verdict.ok,
        blocked: verdict.blocked,
        notes: verdict.notes,
        totalUsd: verdict.totalUsd,
      },
      simulation: simState,
      credits: {
        used: quota.used,
        quota: quota.quota,
        remaining: quota.remaining,
      },
      capabilities,
    },
    outcome,
  };
}

export async function recoverAgentTurn(args: {
  aiError: unknown;
  streamed?: boolean;
  primaryProvider?: ChatProvider | null;
  chainId?: number;
  meterAddress?: string;
  quota: { used: number; quota: number; remaining: number };
  capabilities: CapabilitySnapshot;
  startedAt: number;
  requestId: string;
  jev?: {
    route: JevRoute | null;
    confidence: number | null;
    normalizerSkipped: boolean;
  };
}): Promise<SettledTurnResponse> {
  const {
    aiError,
    streamed = false,
    primaryProvider,
    chainId,
    meterAddress,
    quota,
    capabilities,
    startedAt,
    requestId,
    jev,
  } = args;

  console.error("[chat] provider failed:", aiError);
  const errObj = aiError as { message?: unknown; name?: unknown; code?: unknown };
  const blocked = /content[-_ ]?blocked|content[-_ ]?filter/i.test(
    String(errObj?.message ?? ""),
  );
  const refunded = blocked
    ? await releaseModelRequest(meterAddress, quota)
    : null;

  await logAgentTurn({
    status: blocked ? "provider_blocked" : "provider_error",
    provider: primaryProvider?.id ?? null,
    latencyMs: Date.now() - startedAt,
    stream: streamed,
    chainId,
    address: meterAddress,
    jevRoute: jev?.route ?? null,
    jevConfidence: jev?.confidence ?? null,
    jevNormalizerSkipped: jev?.normalizerSkipped ?? false,
    error: String(errObj?.name ?? errObj?.code ?? "error").slice(0, 60),
  });

  const response = blocked
    ? "The model gateway refused that wording — it screens messages shaped like a transfer instruction. Say it as a command, like `swap 100 USDC to EURC`, and it runs here without a reasoning request. Questions about your positions or the markets are unaffected."
    : "I couldn't complete that just now — the reasoning service returned an error. Try again shortly.";

  const outcome = classifyTurn(
    {
      text: response,
      reads: [],
      executes: [],
      provider: primaryProvider?.id ?? "unknown",
      model: primaryProvider?.model ?? "unknown",
      trace: [],
      rounds: 0,
    },
    {
      kind: "unavailable",
      reason: blocked ? "provider_blocked" : "provider_error",
      retryable: !blocked,
    },
  );

  return {
    response,
    context: {
      status: blocked ? "provider_blocked" : "provider_error",
      requestId,
      outcome: outcome.kind,
      capabilities,
      ...(refunded ? { credits: refunded } : {}),
    },
    outcome,
  };
}
