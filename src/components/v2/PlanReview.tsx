"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { toast } from "sonner";
import { ErrorDecoder } from "ethers-decode-error";
import { readTokenBalance } from "@/lib/chain/tokenBalance";
import { providerForChain } from "@/config/provider";
import { getChainMeta } from "@/constants/chains";
import { renderIntent, resolveIntent, type Intent } from "@/lib/v2/intents";
import { encodeBatch, planRuns } from "@/lib/v2/intents/batch";
import { useResolverContext } from "@/hooks/v2/useResolverContext";
import { useSwitchWalletChain } from "@/lib/wallet";
import { useBatchCalls } from "@/hooks/v2/useBatchCalls";
import { recordTx, txFromError } from "@/lib/v2/txLog";
import { recordCctpBurn } from "@/lib/bridge/cctpPending";
import { describeFailure, isRejection } from "@/lib/v2/txErrors";
import { PROTOCOL_ERROR_ABI } from "@/lib/v2/protocolErrors";
import SwapRoute from "./SwapRoute";
import s from "./PlanReview.module.css";

/* One decoder for every step, carrying the union of the errors a plan can hit
   (see protocolErrors). Without it a bespoke Protocol__ error matched nothing and
   the decoder's `reason` became ethers' raw "…not found on ABI" complaint — which
   is exactly what a tester saw when a borrow reverted with
   Protocol__NoCollateralDeposited. With it, describeFailure names the error and
   maps the actionable ones to a sentence. The RPC-level cases (declined, out of
   gas, wrong network, pending nonce) still resolve without any ABI. */
const errorDecoder = ErrorDecoder.create([PROTOCOL_ERROR_ABI]);

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

/** One step as it actually finished, for the caller to report. */
export interface SettledStep {
  /** The same title the step showed while it ran. */
  title: string;
  /** Absent for a step that broadcast nothing — a skipped approve, or a
   *  signature-only step like placing an order. */
  hash?: string;
  skipped: boolean;
  /**
   * Wall-clock milliseconds for this step: the wallet prompt AND the receipt.
   *
   * Recorded because testers report the agent as slow and nothing measured it.
   * Every resolver ends in `await tx.wait()` and the steps run in sequence, so
   * a plan costs a signature plus a full block confirmation per step - about
   * 12-24s each on Sepolia before the user has clicked anything. Which half is
   * the wait and which is the human is not knowable from here, so this is the
   * honest total rather than a breakdown that would need a guess.
   */
  ms?: number;
}

interface PlanReviewProps {
  intents: Intent[];
  /** Shown on the primary button, e.g. "Sign & swap". */
  submitLabel?: string;
  /**
   * Whether to hand control back between steps. See AgentSettings.stepMode.
   *
   * Only two of the three modes can reach this component. `agent` is the
   * on-chain mandate, and a delegated action is executed by whoever holds the
   * grant against the contract - it never becomes a plan anyone reviews here.
   * So the caller maps it to `auto`: if a plan IS on screen under that mode,
   * the user is signing it themselves and asked not to be stopped.
   *
   * What this gates is THIS COMPONENT'S pause, never the wallet's prompt.
   * Every step is a separate signature under either mode - that is not ours to
   * switch off, and a setting that appeared to would be the worst kind of
   * guardrail. Under `auto` the loop runs and the prompts arrive back to back,
   * so declining one is still how a plan is stopped part-way.
   */
  stepMode?: "manual" | "auto";
  /**
   * Called after every step succeeds, WITH what settled.
   *
   * It used to take no arguments, and the caller had nothing to say
   * afterwards as a result: the agent page cleared the plan and left the
   * sentence it had written BEFORE anything was signed sitting in the
   * transcript. So "stake 100 KLD" was answered with "Stake 100 KLD for
   * stKLD." both before and after the wallet prompt, and a tester reported
   * exactly that — a reply that repeats itself and never says whether the
   * transaction worked. This component knew every status and every hash the
   * whole time; nothing carried them up.
   */
  onComplete?: (settled: SettledStep[]) => void;
  onCancel?: () => void;
  /**
   * Pin the plan to the chain it was prepared on, and refuse to sign it from any
   * other. A plan's intents encode addresses that are only valid on one chain,
   * and the same address is a different token across chains — USDe on BSC testnet
   * is USDT on Arc — so a wallet that switched networks between reading the plan
   * and signing it would approve or transfer the wrong asset. The connected chain
   * at first render is captured as the plan's chain.
   *
   * Opt-in, because the flows that switch the wallet chain as a deliberate step
   * before signing (the multichain Swap gate) would trip a naive pin. The agent
   * passes it: there, the plan is built for the connected chain and reviewed on
   * it, so a later switch is exactly the mistake to catch.
   */
  pinChain?: boolean;
  /**
   * When the plan's quotes were priced, epoch ms. A swap or a liquidity mint
   * carries a `minOut`/floor computed against the pool's price at plan time; if
   * the plan then sits unsigned while the market moves, that floor is stale — it
   * either reverts at estimate (a floor too high for the new price) or accepts an
   * execution worse than the user was shown. Given, the sign is refused past
   * STALE_QUOTE_MS with a re-ask, so a stale quote is never signed silently.
   * Omitted (or on a plan with no quoted step) means no staleness gate.
   */
  quotedAt?: number;
  /**
   * The step to resume execution at — the index of the first step NOT already
   * settled in a prior mount. Default 0 (a fresh plan).
   *
   * This is the safety half of re-opening a partly executed plan. Within one
   * mounted instance, a stop or a failure leaves `next` pointing past the steps
   * that landed, so a resume never re-signs them. But closing the panel unmounts
   * this component, and re-opening it used to mount a fresh one at step 0 —
   * re-broadcasting an approve (which self-skips) and, worse, a swap or a stake
   * (which do not). Given here, execution begins at `startFrom` and the earlier
   * steps render as already done rather than being run again. The caller keeps
   * this in step via {@link onHalt}.
   */
  startFrom?: number;
  /**
   * Reports the resume index whenever execution stops short of the end — a
   * declined signature, a revert, or a manual-mode pause. The caller stores it on
   * the plan so the next mount resumes there rather than from the top. Not called
   * on completion; `onComplete` is the end.
   */
  onHalt?: (nextIndex: number) => void;
}

/* How long a priced plan may sit before it must be re-quoted. Long enough to
   read a two-step plan without being rushed, short enough that a normal market
   move has not invalidated the floor. */
const STALE_QUOTE_MS = 90_000;

/* The intent kinds whose plan carries a price-derived floor — the only ones a
   stale quote can misprice. A send, stake, repay or approve has no quote. */
const QUOTED_KINDS = new Set([
  "swap",
  "swapMultiHop",
  "mintPoolPosition",
  "increasePoolLiquidity",
]);

/**
 * What the wallet SPENDS for one intent — the token leaving it and how much —
 * or null when the intent spends nothing checkable here.
 *
 * Only the swap kinds, deliberately. It exists to stop a plan the wallet cannot
 * afford (a 100 USDC swap on a 7 USDC balance) from reaching the signature, and
 * a swap is where an absolute amount escapes the check: a RELATIVE amount ("half
 * my USDC") was already capped at the balance in build.ts, but "swap 100 USDC"
 * was not. A `swap` funded from native is skipped — the router wraps the native
 * itself, so the ERC20 leg's balance is not what pays. `aggregatorSwap` carries
 * the 0x3600 mirror as `tokenIn`, whose balanceOf reads the native balance, so
 * that IS the check on Arc.
 */
function spendOf(
  intent: Intent,
): { token: string; amount: string; decimals: number; symbol: string } | null {
  if (intent.kind === "aggregatorSwap")
    return {
      token: intent.tokenIn,
      amount: intent.amountIn,
      decimals: intent.decimalsIn,
      symbol: intent.symbolIn,
    };
  if (intent.kind === "swap" && !intent.nativeIn)
    return {
      token: intent.tokenIn,
      amount: intent.amountIn,
      decimals: intent.decimalsIn,
      symbol: intent.symbolIn,
    };
  return null;
}

export default function PlanReview({
  intents,
  submitLabel = "Sign & execute",
  stepMode = "manual",
  onComplete,
  onCancel,
  pinChain = false,
  quotedAt,
  startFrom = 0,
  onHalt,
}: PlanReviewProps) {
  const getContext = useResolverContext();
  const switchChain = useSwitchWalletChain();
  /* The chain the plan must be signed on, captured once.
     Prefer the chain the plan's OWN intents name over the connected chain: a
     bridge carries its source `fromChainId`, an aggregator swap / CCTP mint its
     `chainId`. For an ordinary plan these equal the connected chain, so this is a
     no-op there; where they differ (a bridge built for a source the wallet is not
     on) it is what lets the sign flow switch to the RIGHT chain rather than the
     one the wallet happened to be on when review opened. */
  const pinnedChain = useRef<number | null>(null);
  useEffect(() => {
    if (!pinChain || pinnedChain.current != null) return;
    const fromIntents = intents.reduce<number | null>((acc, it) => {
      if (acc != null) return acc;
      if (it.kind === "bridge") return it.fromChainId;
      if (it.kind === "aggregatorSwap" || it.kind === "cctpReceive")
        return it.chainId;
      return null;
    }, null);
    if (fromIntents != null) {
      pinnedChain.current = fromIntents;
      return;
    }
    const c = getContext();
    if (c) pinnedChain.current = c.chainId;
  }, [pinChain, getContext, intents]);
  /* The latest resolver context, in a ref so an in-flight run() can read the
     wallet's CURRENT chain after an auto-switch. getContext is closed over at the
     render run() started on, so it reports the OLD chain until a re-render — this
     ref is what lets the sign flow wait for the switch to actually land and then
     build the signer on the new chain. */
  const ctxRef = useRef(getContext);
  useEffect(() => {
    ctxRef.current = getContext;
  }, [getContext]);
  const { support: batch, send: sendBatch } = useBatchCalls();
  const views = useMemo(() => intents.map(renderIntent), [intents]);

  /* Not enough to spend it? A plan the wallet can't afford would build, read
     fine through the steps, and revert at signing — the swap form guards this,
     the agent's review did not. Sum what the wallet spends per token, read the
     balance, and block the SIGNATURE (not the review, so the numbers still show)
     when a token comes up short. A balance we cannot read never blocks: the
     chain is the judge then, not a missing read. */
  const [shortfall, setShortfall] = useState<{
    symbol: string;
    have: string;
    want: string;
  } | null>(null);

  /**
   * The other half of a CCTP transfer needs gas on the OTHER chain.
   *
   * A burn here mints there only when someone submits `receiveMessage` on the
   * destination, and that costs gas the user may not hold — measured: 10 USDC
   * burned on Arc by a wallet with no ETH on Base, unmintable. So before a
   * CCTP burn is signed, read the destination balance. If it cannot cover a
   * mint, ask the server whether the completion keeper will pay it: if so,
   * say so and carry on (nothing is needed there); if not, block the sign the
   * way a source-side shortfall blocks it — burning into a trap is the one
   * outcome worse than not bridging. An unreadable destination blocks nothing:
   * the guard exists to stop a known trap, not to add a new way to fail.
   */
  const [destGas, setDestGas] = useState<{
    chain: string;
    keeper: boolean;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ctx = getContext();
    const burn = intents.find(
      (it) =>
        it.kind === "bridge" && (it as { provider?: string }).provider === "cctp",
    ) as (Extract<Intent, { kind: "bridge" }> & { toChainId: number; toChainName: string }) | undefined;
    if (!ctx?.address || !burn) {
      setDestGas(null);
      return;
    }
    void (async () => {
      const provider = providerForChain(burn.toChainId);
      if (!provider) return;
      try {
        const [balance, fee] = await Promise.all([
          provider.getBalance(ctx.address),
          provider.getFeeData(),
        ]);
        if (cancelled) return;
        const perGas = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
        // receiveMessage V2 measured ~180–250k gas; a comfortable ceiling.
        const need = perGas * 300_000n;
        if (balance > 0n && balance >= need) {
          setDestGas(null);
          return;
        }
        let keeper = false;
        try {
          const res = await fetch("/api/cctp/status", { cache: "no-store" });
          if (res.ok) keeper = Boolean(((await res.json()) as { keeper?: boolean }).keeper);
        } catch {
          /* Unknown reads as "no keeper" — the cautious reading. */
        }
        if (cancelled) return;
        setDestGas({
          chain: getChainMeta(burn.toChainId)?.shortName ?? burn.toChainName,
          keeper,
        });
      } catch {
        /* See above: an unreadable destination does not block the source. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [intents]);
  useEffect(() => {
    let cancelled = false;
    const ctx = getContext();
    if (!ctx?.address) {
      setShortfall(null);
      return;
    }
    const chainId = pinnedChain.current ?? ctx.chainId;
    const wantByToken = new Map<
      string,
      { symbol: string; decimals: number; total: bigint }
    >();
    for (const it of intents) {
      const spend = spendOf(it);
      if (!spend) continue;
      let raw: bigint;
      try {
        raw = ethers.parseUnits(spend.amount, spend.decimals);
      } catch {
        continue;
      }
      const key = spend.token.toLowerCase();
      const cur = wantByToken.get(key);
      if (cur) cur.total += raw;
      else
        wantByToken.set(key, {
          symbol: spend.symbol,
          decimals: spend.decimals,
          total: raw,
        });
    }
    if (wantByToken.size === 0) {
      setShortfall(null);
      return;
    }
    void (async () => {
      for (const [token, entry] of wantByToken) {
        const have = await readTokenBalance(chainId, ctx.address, token);
        if (cancelled) return;
        if (have !== null && entry.total > have) {
          setShortfall({
            symbol: entry.symbol,
            have: ethers.formatUnits(have, entry.decimals),
            want: ethers.formatUnits(entry.total, entry.decimals),
          });
          return;
        }
      }
      if (!cancelled) setShortfall(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [intents, getContext]);
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
  /* A ref, not state: the run loop reads this immediately after the last step
     and a setState would still be a render behind. Nothing renders from it. */
  const settledRef = useRef<SettledStep[]>([]);

  /* Steps before `startFrom` settled in a prior mount, so they open as done and
     are never run again — see the startFrom prop. */
  const [statuses, setStatuses] = useState<StepStatus[]>(() =>
    intents.map((_, i) => (i < startFrom ? "done" : "idle")),
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
  const [next, setNextState] = useState(startFrom);
  /* A ref mirror of `next`, so the moment the loop halts its resume index can be
     reported to the caller synchronously — a setNext is React state and would not
     be readable in the same tick. Every setNext goes through here. */
  const nextRef = useRef(startFrom);
  const setNext = (n: number) => {
    nextRef.current = n;
    setNextState(n);
  };

  /**
   * Set for the duration of one "run them all" press, and only that press.
   *
   * A ref rather than state because `pauseAfter` is called from inside the
   * async loop: a state read there is whatever it was when the loop started,
   * which for a flag set by the same click is always the old value.
   *
   * `run` assigns it on every entry, so it resets itself — after a failure
   * part-way through an unstopped run, the ordinary button resumes stepwise
   * again. That is the right default to fall back to: something already went
   * wrong, and the click between steps is the thing that lets you look.
   */
  const noPauseRef = useRef(false);

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
    if (noPauseRef.current) return false;
    if (stepMode !== "manual" || skipped || i >= intents.length - 1) return false;
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
    const startedAt = Date.now();
    try {
      const result = await resolveIntent(ctx, intents[i]);
      setStep(i, result.skipped ? "skipped" : "done");
      settledRef.current[i] = {
        title: views[i].title,
        hash: result.hash ?? undefined,
        skipped: !!result.skipped,
        ms: Date.now() - startedAt,
      };
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
      /* A CCTP burn is only half a transfer: the USDC is minted on the
         destination by a later `receiveMessage`, once Circle attests. Record the
         burn so the completion surface (and Luca) can offer to finish it. Inert
         in production until CCTP_ENABLED — no `provider:"cctp"` bridge is built
         while the corridor is off — so this costs nothing until go-live. */
      if (result.hash && intents[i].kind === "bridge") {
        const b = intents[i] as Extract<Intent, { kind: "bridge" }>;
        if (b.provider === "cctp") {
          recordCctpBurn(ctx.address, {
            txHash: result.hash,
            sourceChainId: b.fromChainId,
            destChainId: b.toChainId,
            destChainName: b.toChainName,
            amount: b.amount,
            symbol: b.symbol,
            burnedAt: Date.now(),
          });
        }
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

      /*
       * A decline is not a failure — the user chose not to sign this step — so it
       * resets to idle rather than turning red, and says so plainly; a "failed,
       * nothing further was signed" toast on a deliberate cancel reads as a bug. A
       * real failure keeps the red marker and carries the DECODED reason — a
       * slippage revert, out-of-gas, wrong network, a pending nonce — instead of
       * one generic sentence that made a stale-quote revert look like a user
       * cancel. Either way the plan halts here.
       */
      const decoded = await errorDecoder.decode(err);
      const message = describeFailure(decoded, err, PROTOCOL_ERROR_ABI);
      setRunning(false);
      setNext(i);
      if (isRejection(decoded)) {
        setStep(i, "idle");
        toast.info(message);
      } else {
        setStep(i, "failed");
        /* When the step that failed was preceded by an approval that actually
           landed (not one that self-skipped because the allowance already
           existed), that allowance is now standing at a spender for an action
           that did not happen. Naming it is the honest thing: the user approved
           it as part of one plan, and half of that plan reverted. A dangling
           allowance is not dangerous on its own, but it is the user's to know
           about and to leave or revoke. */
        const prev =
          i > 0
            ? (intents[i - 1] as {
                kind: string;
                symbol?: string;
                amount?: string;
              })
            : null;
        const prevLanded =
          i > 0 &&
          !!settledRef.current[i - 1]?.hash &&
          !settledRef.current[i - 1]?.skipped;
        const allowanceNote =
          prev?.kind === "approve" && prevLanded && prev.symbol
            ? ` The ${prev.symbol} approval from the previous step is still in place${
                prev.amount ? ` (up to ${prev.amount})` : ""
              } — you can leave it or revoke it in your wallet.`
            : "";
        toast.error(`${views[i].title} — ${message}${allowanceNote}`);
      }
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
    const bundleStartedAt = Date.now();
    const calls = encodeBatch(intents, steps, ctx.address);
    if (!calls) return runSequential(ctx, steps);

    for (const i of steps) setStep(i, "pending");

    /*
     * A THROW and a `ok:false` are different outcomes and must not be treated the
     * same, which the old code did — both ended in the sequential fallback.
     *
     * A throw is the bundle NEVER LANDING: a wallet that won't honour an
     * atomicRequired bundle, or the user cancelling. atomicRequired forbids a
     * half-execution, so nothing was sent and the steps are safe to offer one at
     * a time from the top of the pair.
     *
     * `ok:false` is the bundle MINING AND REVERTING atomically. Nothing was
     * applied, but re-running it per step would hit the same revert (a stale
     * floor, a moved market) and charge gas for it — so it is reported as a
     * failure, not silently re-prompted like a bundle that was never sent. A
     * fresh plan is the fix, not a retry.
     */
    let result: { hashes: string[]; ok: boolean };
    try {
      result = await sendBatch(calls);
    } catch (err) {
      console.warn(
        "[PlanReview] bundle not sent, falling back to one signature per step:",
        err,
      );
      for (const i of steps) setStep(i, "idle");
      return runSequential(ctx, steps);
    }

    if (!result.ok) {
      console.warn("[PlanReview] bundle reverted on chain, not re-signing.");
      for (const i of steps) setStep(i, "failed");
      setRunning(false);
      setNext(steps[0]);
      toast.error(
        "The bundled transaction reverted on chain — nothing was applied. Ask again for a fresh plan.",
      );
      return "failed";
    }

    /*
     * ONE HASH CAN COVER SEVERAL STEPS, which is the whole point of a bundle and
     * the one thing the history has to be told about honestly. An atomic bundle
     * reports a single receipt, so both steps are recorded against the same
     * hash — and `recordTx` keys on the hash, replacing rather than appending, so
     * a naive loop would leave the log showing only the last step. The rows are
     * merged into one entry titled for the whole pair, which is what the user
     * signed. (Recorded outside any sendBatch try, so a throw HERE — a bundle
     * that succeeded — cannot fall through to the sequential re-sign and double
     * execute it.)
     */
    const { hashes } = result;
    const hash = hashes[0];
    for (const i of steps) {
      settledRef.current[i] = {
        title: views[i].title,
        hash: hash ?? undefined,
        skipped: false,
        ms: Date.now() - bundleStartedAt,
      };
    }
    if (hash) {
      recordTx(ctx.chainId, ctx.address, {
        hash,
        kind: intents[steps[steps.length - 1]].kind,
        title: views[steps[steps.length - 1]].title,
        detail: `${steps.map((i) => views[i].title).join(", then ")} — signed together.`,
        status: "confirmed",
        at: Date.now(),
      });
      /* Same CCTP burn record as the sequential path: a bundled burn confirms
         under one hash and the bridge is the pair's last step. Inert until
         CCTP_ENABLED — see runStep. */
      const lastIntent = intents[steps[steps.length - 1]];
      if (lastIntent.kind === "bridge") {
        const b = lastIntent as Extract<Intent, { kind: "bridge" }>;
        if (b.provider === "cctp") {
          recordCctpBurn(ctx.address, {
            txHash: hash,
            sourceChainId: b.fromChainId,
            destChainId: b.toChainId,
            destChainName: b.toChainName,
            amount: b.amount,
            symbol: b.symbol,
            burnedAt: Date.now(),
          });
        }
      }
    }
    for (const i of steps) setStep(i, "done");

    const last = steps[steps.length - 1];
    if (pauseAfter(last, false)) return "paused";
    return "done";
  };

  /**
   * @param withoutStopping Run every remaining step back to back.
   *
   * What it removes is THIS COMPONENT'S pause between steps, never a wallet
   * prompt. Every step is still its own signature — that is not ours to switch
   * off, and a button that appeared to would be the worst kind of guardrail.
   * Declining a prompt is still how an unstopped run gets stopped part-way.
   *
   * Assigned unconditionally so the flag cannot outlive the press that set it.
   */
  const run = async (withoutStopping = false) => {
    noPauseRef.current = withoutStopping;
    let ctx = getContext();
    if (!ctx) {
      toast.error("Connect a wallet to continue.");
      return;
    }
    /* The plan is only valid on the chain it was prepared on — its addresses are
       that chain's, and the same address is a different token elsewhere. Rather
       than refuse when the wallet has moved, switch it BACK to the plan's chain
       and sign there — the switch is the safety the pin wanted, so folding it
       into the sign (the way the swap page folds it into startSwap) is strictly
       safer than a dead end, never less. A declined or failed switch stops here,
       so nothing is ever signed on the wrong chain. */
    if (
      pinChain &&
      pinnedChain.current != null &&
      ctx.chainId !== pinnedChain.current
    ) {
      const target = pinnedChain.current;
      const name =
        getChainMeta(target)?.shortName ??
        getChainMeta(target)?.name ??
        `chain ${target}`;
      try {
        await switchChain(target);
      } catch {
        toast.error(
          `This plan is for ${name} — approve the network switch, or switch your wallet to it and try again.`,
        );
        return;
      }
      /* Wait for the switch to actually land: switchChain resolving is the
         wallet accepting, but the React context and signer catch up a render
         later, so poll the live ref until it reports the target chain (a few
         seconds) before building a signer on it. */
      const fresh = await (async () => {
        for (let i = 0; i < 50; i += 1) {
          const c = ctxRef.current();
          if (c && c.chainId === target) return c;
          await new Promise((r) => setTimeout(r, 100));
        }
        return null;
      })();
      if (!fresh) {
        toast.error(
          `Couldn't confirm the switch to ${name} — switch your wallet to it and try again.`,
        );
        return;
      }
      ctx = fresh;
    }
    /* A priced plan whose quotes have gone stale must not be signed silently: the
       slippage floor was computed against a price that has since moved, so the
       transaction either reverts at estimate or fills worse than the user was
       shown. Refuse past the window and send them back to re-ask, which re-quotes
       against now. Only for a plan that actually carries a quote — a send or a
       stake has no floor to go stale. Checked at sign time, so age that accrued
       while the panel sat open is caught regardless of when it last rendered. */
    if (
      quotedAt !== undefined &&
      Date.now() - quotedAt > STALE_QUOTE_MS &&
      intents.some((i) => QUOTED_KINDS.has(i.kind))
    ) {
      toast.error(
        "This quote is over 90 seconds old — ask again for a fresh price before signing.",
      );
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
        if (settled !== "done") {
          /* nextRef was set by runBundle (or the sequential fallback inside it)
             to where a resume should begin — report it so a re-open starts there
             rather than re-signing the steps that landed. */
          onHalt?.(nextRef.current);
          return;
        }
        /* The pair is done; skip the step the bundle covered. */
        i = bundle.steps[bundle.steps.length - 1];
        continue;
      }

      const outcome = await runStep(ctx, i);
      if (outcome !== "done") {
        onHalt?.(nextRef.current);
        return;
      }
    }
    setRunning(false);
    setDone(true);
    onComplete?.(settledRef.current.filter(Boolean));
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

      {/* Named before the buttons, so the reason the sign button is disabled sits
          next to it. Hidden once the plan is under way — by then the balance was
          enough to start, and a later step failing has its own message. */}
      {shortfall && !running && next === 0 && (
        <div className={s.shortfall}>
          Not enough {shortfall.symbol}: you have {shortfall.have}, this needs{" "}
          {shortfall.want}.
        </div>
      )}
      {destGas && !running && next === 0 && (
        destGas.keeper ? (
          <div className={s.stNote}>
            No gas needed on {destGas.chain}: once Circle attests, the mint there
            is completed for you.
          </div>
        ) : (
          <div className={s.shortfall}>
            You have no gas on {destGas.chain} to finish this transfer on the
            other side, and nothing can pay it for you yet. Add a little{" "}
            {destGas.chain} gas first — the mint there is what needs it.
          </div>
        )
      )}

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
          <button
            className={s.primary}
            onClick={() => onComplete?.(settledRef.current.filter(Boolean))}
          >
            Done
          </button>
        ) : (
          /* Wrapped, not passed by reference: `onClick={run}` would hand the
             click event in as `withoutStopping`, and an event object is
             truthy — every plan would run unstopped. */
          <button
            className={s.primary}
            onClick={() => run()}
            disabled={running || (next === 0 && (!!shortfall || (!!destGas && !destGas.keeper)))}
          >
            {running
              ? "Signing…"
              : next > 0
                ? `Sign step ${next + 1} of ${intents.length}`
                : submitLabel}
          </button>
        )}
      </div>

      {/* The other way to take a multi-step plan, offered where the choice is
          actually made rather than behind Agent Settings — a tester asked for
          it at the plan, which is the only place the number of steps is known.

          Under the actions rather than beside them: it is an alternative to the
          button above, not a competitor for it, and a third control in that row
          reads as a third decision. Counted from `next` so a plan resumed after
          a pause offers what is left, not what it started with, and hidden once
          fewer than two steps remain — "run all 1" is the button above. */}
      {!done && stepMode === "manual" && intents.length - next > 1 && (
        <button
          className={s.alt}
          onClick={() => run(true)}
          disabled={running || (next === 0 && (!!shortfall || (!!destGas && !destGas.keeper)))}
        >
          {next > 0
            ? `Run the remaining ${intents.length - next} without stopping`
            : `Run all ${intents.length} without stopping`}
        </button>
      )}

      {/* "Each step is a separate signature" is the load-bearing sentence in this
          component, and batching is the one thing that makes it false — so it is
          replaced rather than appended to. A footnote saying two steps share a
          prompt underneath a line saying they cannot is worse than either alone.
          The count is the number of prompts, which is what the reader is being
          told to expect. */}
      <p className={s.foot}>
        {batchable
          ? `${prompts} signature${prompts === 1 ? "" : "s"} for ${intents.length} steps — your wallet can approve some of them together. Nothing runs until you approve it, and a failure stops the rest.`
          : stepMode === "manual" && intents.length > 1
            ? "Each step is a separate signature, and the plan stops between them so you can stop after any one. Running them all removes the stops, not the signatures — your wallet still asks for each. A failure stops the rest."
            : "Each step is a separate signature. Nothing runs until you approve it, and a failure stops the rest."}
      </p>
    </div>
  );
}
