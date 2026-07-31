"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  renderIntent,
  resolveIntent,
  type Intent,
} from "@/lib/v2/intents";
import { useResolverContext } from "@/hooks/v2/useResolverContext";
import s from "./PlanReview.module.css";

/**
 * PlanReview — the one component that turns an intent[] into signable steps.
 *
 * Every caller (Luca's resolved plan, a Swap's approve+swap, a Portfolio Repay)
 * hands it the same shape and gets the same review-and-sign flow. It renders
 * each step through the registry and executes the resolvers in order, tracking
 * per-step status — which is exactly the per-leg model a cross-chain action
 * needs, generalised to any multi-step plan.
 */

type StepStatus = "idle" | "pending" | "done" | "skipped" | "failed";

interface PlanReviewProps {
  intents: Intent[];
  /** Shown on the primary button, e.g. "Sign & swap". */
  submitLabel?: string;
  /** Called after every step succeeds. */
  onComplete?: () => void;
  onCancel?: () => void;
}

export default function PlanReview({
  intents,
  submitLabel = "Sign & execute",
  onComplete,
  onCancel,
}: PlanReviewProps) {
  const getContext = useResolverContext();
  const views = useMemo(() => intents.map(renderIntent), [intents]);
  const [statuses, setStatuses] = useState<StepStatus[]>(
    () => intents.map(() => "idle"),
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const setStep = (i: number, status: StepStatus) =>
    setStatuses((prev) => prev.map((s0, idx) => (idx === i ? status : s0)));

  const run = async () => {
    const ctx = getContext();
    if (!ctx) {
      toast.error("Connect a wallet to continue.");
      return;
    }
    setRunning(true);
    for (let i = 0; i < intents.length; i++) {
      setStep(i, "pending");
      try {
        const result = await resolveIntent(ctx, intents[i]);
        setStep(i, result.skipped ? "skipped" : "done");
      } catch (err) {
        console.error("[PlanReview] step failed:", intents[i].kind, err);
        setStep(i, "failed");
        setRunning(false);
        toast.error(`${views[i].title} failed. Nothing further was signed.`);
        return;
      }
    }
    setRunning(false);
    setDone(true);
    onComplete?.();
  };

  const mark = (status: StepStatus, n: number) => {
    switch (status) {
      case "done":
        return "✓";
      case "skipped":
        return "–";
      case "failed":
        return "✕";
      case "pending":
        return <span className={s.spin} aria-label="in progress" />;
      default:
        return n;
    }
  };

  return (
    <div className={s.wrap}>
      <div className={s.title}>Review and sign</div>

      <ol className={s.steps}>
        {views.map((v, i) => (
          <li key={i} className={`${s.step} ${s[`st_${statuses[i]}`] ?? ""}`}>
            <span className={s.marker}>{mark(statuses[i], i + 1)}</span>
            <div className={s.body}>
              <div className={s.stTitle}>{v.title}</div>
              {v.detail && <div className={s.stDetail}>{v.detail}</div>}
              {statuses[i] === "skipped" && (
                <div className={s.stNote}>Already done — no transaction needed.</div>
              )}
            </div>
            {v.chain && <span className={s.chain}>{v.chain}</span>}
          </li>
        ))}
      </ol>

      <div className={s.actions}>
        {!done && onCancel && (
          <button className={s.ghost} onClick={onCancel} disabled={running}>
            Cancel
          </button>
        )}
        {done ? (
          <button className={s.primary} onClick={onComplete}>
            Done
          </button>
        ) : (
          <button className={s.primary} onClick={run} disabled={running}>
            {running ? "Signing…" : submitLabel}
          </button>
        )}
      </div>

      <p className={s.foot}>
        Each step is a separate signature. Nothing runs until you approve it, and
        a failure stops the rest.
      </p>
    </div>
  );
}
