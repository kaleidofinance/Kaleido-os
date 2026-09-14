import { NextRequest, NextResponse } from "next/server";

import {
  auditPlan,
  refusalText,
  sanitizeGuardrails,
} from "@/lib/ai/auditor";
import type { PlanStep } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The auditor gate for a plan the client built itself.
 *
 * A plan reaches a signature two ways. The model path builds one from tool calls
 * inside /api/chat and audits it there before the reply is ever sent. The other
 * path is a direct command — "swap 1500 USDC to KLD" typed at Luca — which the
 * browser parses and builds locally, for speed and to spend no reasoning
 * request. That path never touched the auditor, so the per-action USD ceiling a
 * user set in Agent Settings was checked on reasoned plans and silently skipped
 * on typed ones: a tester set $1,000, typed a $1,500 swap, and signed it. This
 * endpoint is that missing gate — the SAME `auditPlan`, so both ways of asking
 * are held to one ceiling rather than two implementations of it.
 *
 * Why the audit is server-side even though the plan came from the browser: the
 * auditor prices notionals against a live oracle (server-only) and, more to the
 * point, a limit evaluated in the page is a limit the page can edit. This runs
 * where the client cannot reach it, exactly as the model path's audit does.
 *
 * It reads only and signs nothing. `limits` is sanitised tightening-only (a bad
 * field cannot raise the ceiling — see sanitizeGuardrails), and `allowedActions`
 * is the user's own product switches. No wallet, no quota: refusing to audit
 * would be worse than auditing for free, because the caller fails closed on any
 * error and would simply not present the plan.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const plan = Array.isArray(body.plan) ? (body.plan as PlanStep[]) : [];
  const chainId = typeof body.chainId === "number" ? body.chainId : undefined;

  /* Same shape the model path receives: guardrails and the product switches ride
     together under `limits`. Sanitised through the shared helper so a typed
     command and a reasoned one clean the caps identically. */
  const rawLimits = (body.limits ?? {}) as Record<string, unknown>;
  const limits = sanitizeGuardrails(rawLimits);
  const allowedActions =
    rawLimits.allowedActions && typeof rawLimits.allowedActions === "object"
      ? (rawLimits.allowedActions as Record<string, boolean>)
      : undefined;

  /* Nothing to sign is vacuously fine — say so without a pricing round-trip. */
  if (plan.length === 0) {
    return NextResponse.json({
      ok: true,
      blocked: [],
      notes: [],
      totalUsd: 0,
      refusal: null,
    });
  }

  const verdict = await auditPlan({ plan, chainId, limits, allowedActions });

  return NextResponse.json({
    ok: verdict.ok,
    blocked: verdict.blocked,
    notes: verdict.notes,
    totalUsd: verdict.totalUsd,
    /* Pre-rendered so the client shows the same refusal wording the model path
       appends, without a second copy of the phrasing. Null when nothing blocked. */
    refusal: verdict.ok ? null : refusalText(verdict),
  });
}
