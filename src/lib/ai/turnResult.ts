import type { AgentRun } from "./agent";

/**
 * The server-facing outcome contract for one Luca turn.
 *
 * The chat route still returns the historical AgentRun shape today, but every
 * caller can now classify the result without guessing from optional fields.
 * In particular, a provider/tool outage is never represented as an answer and
 * a plan is never represented as ready unless the caller explicitly supplies a
 * passed audit/simulation result.
 */
export type TurnOutcomeKind =
  | "answer"
  | "clarification"
  | "plan"
  | "refusal"
  | "unavailable";

export interface TurnPlanState {
  audit: "passed" | "failed" | "not_run";
  simulation: "passed" | "failed" | "unavailable" | "not_run";
}

export type TurnResult =
  | {
      kind: "answer" | "clarification" | "refusal";
      text: string;
      run: AgentRun;
      reason?: string;
    }
  | {
      kind: "plan";
      text: string;
      run: AgentRun;
      plan: TurnPlanState;
    }
  | {
      kind: "unavailable";
      text: string;
      run: AgentRun;
      reason: string;
      retryable: boolean;
    };

export interface TurnClassification {
  kind: TurnOutcomeKind;
  reason?: string;
  plan?: TurnPlanState;
  retryable?: boolean;
}

export function classifyTurn(
  run: AgentRun,
  classification: TurnClassification,
): TurnResult {
  if (classification.kind === "plan") {
    const plan = classification.plan;
    if (!plan || plan.audit !== "passed" || plan.simulation !== "passed") {
      return {
        kind: "unavailable",
        text:
          "I prepared a proposal, but it is not ready for signing because the safety checks did not complete successfully.",
        run,
        reason: "plan_not_verified",
        retryable: plan?.simulation === "unavailable",
      };
    }
    return { kind: "plan", text: run.text, run, plan };
  }

  if (classification.kind === "unavailable") {
    return {
      kind: "unavailable",
      text: run.text,
      run,
      reason: classification.reason ?? "dependency_unavailable",
      retryable: classification.retryable ?? true,
    };
  }

  return {
    kind: classification.kind,
    text: run.text,
    run,
    ...(classification.reason ? { reason: classification.reason } : {}),
  };
}

export function isSignable(result: TurnResult): result is Extract<TurnResult, { kind: "plan" }> {
  return result.kind === "plan" && result.plan.audit === "passed" && result.plan.simulation === "passed";
}
