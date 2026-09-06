"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { renderIntent, resolveIntent, type Intent } from "@/lib/v2/intents";
import { encodeBatch, planRuns } from "@/lib/v2/intents/batch";
import { useResolverContext } from "@/hooks/v2/useResolverContext";
import { useBatchCalls } from "@/hooks/v2/useBatchCalls";
import { recordTx, txFromError } from "@/lib/v2/txLog";
import SwapRoute from "./SwapRoute";
import s from "./PlanReview.module.css";

/**
 * PlanReview — the one component that turns an intent[] into signable steps.
 *
 * Every caller (Luca's resolved plan, a Swap's approve+swap, a Portfolio Repay)
 * hands it the same shape and gets the same review-and-sign flow. It renders
 * each step through the registry and executes the resolvers in order, tracking
 * per-step status — which is exactly the per-leg model a cross-chain action
 * needs, generalised to any multi-step plan.
 *
 * It is also the only place transactions are recorded to the local log that
 * TxHistory reads, and that follows from the paragraph above: because every
 * signing surface routes through here, one writer covers the swap tab, the agent
 * tab and Portfolio Repay. Recording in the pages instead would mean three
 * writers, each hand-building its own description of a step this component
 * already rendered.
 */

type StepStatus = "idle" | "pending" | "done" | "skipped" | "failed";

interface PlanReviewProps {
  intents: Intent[];
  /** Shown on the primary button, e.g. "Sign & swap". */
  submitLabel?: string;
  /**
   * Hand control back between steps instead of running the plan straight through.
   *
   * The user's `confirmEachStep` setting, and the only caller that passes it is
   * the agent panel — deliberately. A swap's approve+swap is two steps of one
   * thing the user just filled in a form for; a plan Luca drafted is a sequence
   * they are reading for the first time, and the setting is on the agent.
   *
   * What it gates is THIS COMPONENT'S confirmation, not the wallet's. Every step
   * is a separate wallet signature either way — that is not ours to switch off,
   * and a setting that appeared to would be the worst kind of guardrail. Off, the
   * loop runs and the wallet prompts arrive back to back; on, the plan stops after
   * each step that broadcast, so a four-step plan can be abandoned after the
   * second with the first two already settled.
   */
  confirmEachStep?: boolean;
  /** Called after every step succeeds. */
  onComplete?: () => void;
  onCancel?: () => void;
}

export default function PlanReview({
  intents,
  submitLabel = "Sign & execute",
  confirmEachStep = false,
  onComplete,
  onCancel,
}: PlanReviewProps) {
  const getContext = useResolverContext();
  const { support: batch, send: sendBatch } = useBatchCalls();
  const views = useMemo(() => intents.map(renderIntent), [intents]);
  /**
   * Which adjacent steps *could* share one signature, decided from the plan
   * alone — see lib/v2/intents/batch.ts. Computed whether or not the wallet can
   * batch, because it is a property of the plan; whether it is used is decided at
   * execute time by `batch.supported`.
   */
  const runs = useMemo(() => planRuns(intents), [intents]);
  const bundledWith = useMemo(() => {
    /* step index → the other step it shares a signature with, for the footnote
       under each affected row. */
    const map = new Map<number, number>();
    for (const r of runs) {
      if (!r.bundled) continue;
      map.set(r.steps[0], r.steps[1]);
      map.set(r.steps[1], r.steps[0]);
    }
    return map;
  }, [runs]);
  /**
   * Whether to SAY anything about batching.
   *
   * Both halves are required, and the `checking` one is the reason this is a
   * variable rather than an inline `&&`: the capability answer arrives a tick
   * after mount, so a claim rendered before it lands would appear and then
   * disappear on a wallet that cannot batch. Nothing is promised until the wallet
   * has answered.
   */
  const batchable = batch.supported && !batch.checking && bundledWith.size > 0;
  /* Prompts, not steps: one per run. A bundled pair is one prompt. */
  const prompts = runs.length;
  const [statuses, setStatuses] = useState<StepStatus[]>(() =>
    intents.map(() => "idle"),
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  /**
   * The step the next click runs from.
   *
   * Zero until something stops the loop part-way, which is either a pause or a
   * failure. It fixes a real defect in the failure case as well as carrying the
   * pause: the button used to re-enter at 0 after a step failed, so a plan whose
   * *fourth* step reverted would re-broadcast the swap in its second on retry.
   * Steps already on chain are not re-signed.
   */
  const [next, setNext] = useState(0);

  const setStep = (i: number, status: StepStatus) =>
    setStatuses((prev) => prev.map((s0, idx) => (idx === i ? status : s0)));

  /**
   * Stops after step `i` when the setting asks for it, reporting whether it did.
   *
   * A skipped step never pauses. Nothing was signed — the allowance was already
   * there — so asking for a click to continue past a no-op spends a click to
   * confirm that nothing happened. Nor does the last step: there is nothing after
   * it to confirm, and pausing would replace the plan's completion with a button.
   */
  const pauseAfter = (i: number, skipped: boolean) => {
    if (!confirmEachStep || skipped || i >= intents.length - 1) return false;
    setNext(i + 1);
    setRunning(false);
    return true;
  };

  /**
   * Sign one step, the way this component always has.
   *
   * Factored out of the main loop so the bundled path can fall back to it for
   * exactly the steps a bundle would have covered — one executor, so a fallback
   * cannot drift from the path it falls back to. Returns what the caller should do
   * next, and every recording and error rule is unchanged from when this was
   * inline.
   */
  const runStep = async (
    ctx: NonNullable<ReturnType<typeof getContext>>,
    i: number,
  ): Promise<"done" | "failed" | "paused"> => {
    setStep(i, "pending");
    try {
      const result = await resolveIntent(ctx, intents[i]);
      setStep(i, result.skipped ? "skipped" : "done");
      /* Logged with the same title and detail the step above showed, so the
         history reads as a record of what the user approved rather than a
         second, differently-worded account of it. A skipped step has a null
         hash — nothing was broadcast, so there is nothing to record. */
      if (result.hash) {
        recordTx(ctx.chainId, ctx.address, {
          hash: result.hash,
          kind: intents[i].kind,
          title: views[i].title,
          detail: views[i].detail,
          status: "confirmed",
          at: Date.now(),
        });
      }
      return pauseAfter(i, !!result.skipped) ? "paused" : "done";
    } catch (err) {
      console.error("[PlanReview] step failed:", intents[i].kind, err);
      /* Only steps that actually reached the chain are logged, and with the
         outcome the receipt reports rather than "it threw, so it failed" — a
         replaced transaction throws here and may well have succeeded. See
         txFromError for the cases and why each is or is not recorded. */
      const settled = txFromError(err);
      if (settled) {
        recordTx(ctx.chainId, ctx.address, {
          hash: settled.hash,
          kind: intents[i].kind,
          title: views[i].title,
          detail: views[i].detail,
          status: settled.status,
          at: Date.now(),
        });
      }

      /* A transaction the wallet repriced throws here even though it landed —
         ethers reports the replacement rather than following it. The step did
         what it said it would, so it is done and the plan carries on; halting
         with "nothing further was signed" would be false, and it would sit
         beside a history row correctly showing the same transaction as
         confirmed. A cancel is not this case: txFromError returns null there,
         and the step falls through to the failure below. */
      if (settled?.status === "confirmed") {
        setStep(i, "done");
        return pauseAfter(i, false) ? "paused" : "done";
      }

      setStep(i, "failed");
      setRunning(false);
      setNext(i);
      toast.error(`${views[i].title} failed. Nothing further was signed.`);
      return "failed";
    }
  };

  /** Several steps, one at a time. The fallback when a bundle is unavailable. */
  const runSequential = async (
    ctx: NonNullable<ReturnType<typeof getContext>>,
    steps: number[],
  ): Promise<"done" | "failed" | "paused"> => {
    for (const i of steps) {
      const outcome = await runStep(ctx, i);
      if (outcome !== "done") return outcome;
    }
    return "done";
  };

  /**
   * Sign one bundle: several steps, one wallet prompt.
   *
   * Returns what the caller's loop should do next. "done" means carry on past the
   * bundled steps; "failed" and "paused" both mean stop, and the difference is
   * only whether anything went wrong.
   *
   * ── A FAILED BUNDLE FALLS BACK, IT DOES NOT FAIL THE PLAN ─────────────────
   *
   * `atomicRequired: true` means a wallet that cannot honour the bundle refuses
   * it outright rather than half-executing — so a rejection here is very often
   * "this wallet won't", not "this transaction can't". Dropping to the sequential
   * loop is the right response, and it is safe precisely because atomicity was
   * required: nothing was sent, so nothing is half-done and the steps can be
   * signed one at a time from the top of the pair.
   *
   * A user cancelling the prompt looks identical from here, and re-prompting them
   * once per step is a worse experience than a single "cancelled" — but not
   * knowing which it was, the fallback is the only choice that cannot lose money.
   * They can still stop at the next prompt.
   */
  const runBundle = async (
    ctx: NonNullable<ReturnType<typeof getContext>>,
    steps: number[],
  ): Promise<"done" | "failed" | "paused"> => {
    const calls = encodeBatch(intents, steps, ctx.address);
    if (!calls) return runSequential(ctx, steps);

    for (const i of steps) setStep(i, "pending");
    try {
      const { hashes, ok } = await sendBatch(calls);
      if (!ok) throw new Error("The bundled transaction reverted.");

      /*
       * ONE HASH CAN COVER SEVERAL STEPS, which is the whole point of a bundle
       * and the one thing the history has to be told about honestly. An atomic
       * bundle reports a single receipt, so both steps are recorded against the
       * same hash — and `recordTx` keys on the hash, replacing rather than
       * appending, so a naive loop would leave the log showing only the last
       * step. The rows are therefore merged into one entry titled for the whole
       * pair, which is also what the user signed.
       */
      const hash = hashes[0];
      if (hash) {
        recordTx(ctx.chainId, ctx.address, {
          hash,
          kind: intents[steps[steps.length - 1]].kind,
          title: views[steps[steps.length - 1]].title,
          detail: `${steps.map((i) => views[i].title).join(", then ")} — signed together.`,
          status: "confirmed",
          at: Date.now(),
        });
      }
      for (const i of steps) setStep(i, "done");

      const last = steps[steps.length - 1];
      if (pauseAfter(last, false)) return "paused";
      return "done";
    } catch (err) {
      console.warn(
        "[PlanReview] bundle failed, falling back to one signature per step:",
        err,
      );
      for (const i of steps) setStep(i, "idle");
      return runSequential(ctx, steps);
    }
  };

  const run = async () => {
    const ctx = getContext();
    if (!ctx) {
      toast.error("Connect a wallet to continue.");
      return;
    }
    setRunning(true);
    for (let i = next; i < intents.length; i++) {
      /*
       * A bundle is attempted only from its own first step, and only when the
       * wallet declares atomic batching. Two guards, and the second is the
       * subtle one: `next` can land mid-bundle after a pause or a failure, and
       * re-bundling from there would re-sign a step that is already on chain.
       * `runs` is indexed by the plan, not by where this loop resumed.
       */
      const bundle = batch.supported
        ? runs.find((r) => r.bundled && r.steps[0] === i)
        : undefined;
      if (bundle) {
        const settled = await runBundle(ctx, bundle.steps);
        if (settled === "failed") return;
        if (settled === "paused") return;
        /* The pair is done; skip the step the bundle covered. */
        i = bundle.steps[bundle.steps.length - 1];
        continue;
      }

      const outcome = await runStep(ctx, i);
      if (outcome !== "done") return;
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

      {/* The pool and the floor, for a plan that swaps. Above the steps rather
          than inside one, because a route is a property of the plan: with two
          legs it is the thing neither step can state on its own. Renders nothing
          when no step is a swap, which is most plans. */}
      <SwapRoute intents={intents} />

      <ol className={s.steps}>
        {views.map((v, i) => (
          <li key={i} className={`${s.step} ${s[`st_${statuses[i]}`] ?? ""}`}>
            <span className={s.marker}>{mark(statuses[i], i + 1)}</span>
            <div className={s.body}>
              <div className={s.stTitle}>{v.title}</div>
              {v.detail && <div className={s.stDetail}>{v.detail}</div>}
              {statuses[i] === "skipped" && (
                <div className={s.stNote}>
                  Already done — no transaction needed.
                </div>
              )}
              {/* Said on the FIRST row of a pair only, and phrased as what will
                  happen to this step rather than as a feature. A note on both
                  rows would read as two facts about two signatures, which is the
                  opposite of what it is telling them. Hidden once the plan is
                  running: by then the markers show what happened, and a promise
                  about a prompt already answered is noise. */}
              {batchable && !running && !done && bundledWith.get(i) === i + 1 && (
                <div className={s.stNote}>
                  Signed together with the next step, in one transaction.
                </div>
              )}
            </div>
            {v.chain && <span className={s.chain}>{v.chain}</span>}
          </li>
        ))}
      </ol>

      <div className={s.actions}>
        {!done && onCancel && (
          <button className={s.ghost} onClick={onCancel} disabled={running}>
            {/* Named for what it does. Past the first step the plan is part-done
                and this abandons the rest — "Cancel" would suggest undoing what
                is already on chain. */}
            {next > 0 ? "Stop here" : "Cancel"}
          </button>
        )}
        {done ? (
          <button className={s.primary} onClick={onComplete}>
            Done
          </button>
        ) : (
          <button className={s.primary} onClick={run} disabled={running}>
            {running
              ? "Signing…"
              : next > 0
                ? `Sign step ${next + 1} of ${intents.length}`
                : submitLabel}
          </button>
        )}
      </div>

      {/* "Each step is a separate signature" is the load-bearing sentence in this
          component, and batching is the one thing that makes it false — so it is
          replaced rather than appended to. A footnote saying two steps share a
          prompt underneath a line saying they cannot is worse than either alone.
          The count is the number of prompts, which is what the reader is being
          told to expect. */}
      <p className={s.foot}>
        {batchable
          ? `${prompts} signature${prompts === 1 ? "" : "s"} for ${intents.length} steps — your wallet can approve some of them together. Nothing runs until you approve it, and a failure stops the rest.`
          : confirmEachStep && intents.length > 1
            ? "Each step is a separate signature, and the plan stops between them so you can stop after any one. A failure stops the rest."
            : "Each step is a separate signature. Nothing runs until you approve it, and a failure stops the rest."}
      </p>
    </div>
  );
}
