"use client";

import { useState } from "react";
import { toast } from "sonner";
import { getChainMeta } from "@/constants/chains";
import { useCctpPending } from "@/hooks/v2/useCctpPending";
import { useChainGateAction } from "@/hooks/v2/useChainAction";
import { resolveCctpCompletion } from "@/lib/bridge/cctpAttestation";
import type { Intent } from "@/lib/v2/intents";
import Portal from "./Portal";
import PlanReview from "./PlanReview";
import s from "./CctpCompletionBanner.module.css";

/**
 * The global "finish your transfer" bar for CCTP.
 *
 * A CCTP bridge is two transactions on two chains (see lib/bridge/cctp.ts): the
 * source burn, then — once Circle attests — the destination mint. Between them
 * the user's USDC is burned but not yet minted, and there is no on-chain state
 * that reminds them to come back and finish. This bar is that reminder: it reads
 * the per-wallet pending store, and offers to switch to the destination chain,
 * read Circle's attestation, and sign the mint.
 *
 * Mounted once in the app shell so it follows the user across every page — the
 * mint is completed from wherever they are, on whatever chain, not from the page
 * they happened to bridge from. It renders nothing when there is nothing pending,
 * which — with the CCTP corridor still gated off (CCTP_ENABLED) — is always, in
 * production, until go-live: no `provider:"cctp"` burn is built yet, so the
 * pending store stays empty and this bar never appears.
 *
 * One transfer at a time. Completions are independent and a stack of bars would
 * be noise, so the oldest-still-pending is shown with a "+N more" count; the next
 * surfaces once it clears.
 */
export default function CctpCompletionBanner() {
  const { pending, remove, dismiss, keeper } = useCctpPending();
  const [active, setActive] = useState<{ txHash: string; intents: Intent[] } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  // The oldest pending burn is the one to finish first; record prepends, so it
  // is the last element. `undefined` when nothing is pending — every hook above
  // is already called, so the early return below is rules-of-hooks safe.
  const next = pending[pending.length - 1];
  const gate = useChainGateAction(next?.destChainId);

  const onComplete = async () => {
    if (!next || busy) return;
    setBusy(true);
    try {
      // Read Circle's attestation first, so a not-yet-final transfer never asks
      // the user to switch networks for nothing.
      const res = await resolveCctpCompletion({
        sourceChainId: next.sourceChainId,
        sourceChainName:
          getChainMeta(next.sourceChainId)?.shortName ??
          `chain ${next.sourceChainId}`,
        destChainId: next.destChainId,
        txHash: next.txHash,
        amount: next.amount,
        symbol: next.symbol,
      });
      if (!res.ok) {
        // Pending finality reads as info, not error — it is the normal wait.
        toast(res.error);
        return;
      }
      // Ready: make sure the wallet is on the destination chain, then open the
      // one-step mint plan. PlanReview signs it on that chain.
      if (gate.wrong && !(await gate.goToChain())) return;
      setActive({ txHash: next.txHash, intents: res.build.intents });
    } finally {
      setBusy(false);
    }
  };

  if (!next) return null;

  const sourceName =
    getChainMeta(next.sourceChainId)?.shortName ?? `chain ${next.sourceChainId}`;
  const others = pending.length - 1;

  return (
    <>
      <div className={s.bar} role="status">
        <span className={s.dot} aria-hidden />
        <p className={s.text}>
          <strong>
            {next.amount} {next.symbol}
          </strong>{" "}
          from {sourceName} is waiting to finish on {next.destChainName}.
          {keeper
            ? " It completes for you once Circle attests — usually within a few minutes, no gas needed there. Or finish it now:"
            : ""}
          {others > 0 && (
            <span className={s.more}>
              {" "}
              +{others} more transfer{others > 1 ? "s" : ""}
            </span>
          )}
        </p>
        <button
          className={s.cta}
          onClick={onComplete}
          disabled={busy || gate.switching}
        >
          {busy
            ? "Checking…"
            : gate.switching
              ? "Switching…"
              : gate.wrong
                ? `Switch to ${next.destChainName}`
                : `Complete on ${next.destChainName}`}
        </button>
        <button
          className={s.close}
          onClick={() => dismiss(next.txHash)}
          aria-label="Dismiss this reminder"
          title="Dismiss — your USDC is safe; it stays claimable and the bar clears itself once it lands"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M3 3l8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {active && (
        <Portal>
          <div className={s.overlay} onClick={() => setActive(null)}>
            <div className={s.modal} onClick={(e) => e.stopPropagation()}>
              <PlanReview
                intents={active.intents}
                submitLabel="Complete transfer"
                onComplete={() => {
                  remove(active.txHash);
                  setActive(null);
                  toast.success("Transfer completed — your USDC has minted.");
                }}
                onCancel={() => setActive(null)}
              />
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
