"use client";

import { useEffect, useState } from "react";
import Portal from "./Portal";
import { useTxLog } from "@/hooks/v2/useTxLog";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { getChainTxUrl } from "@/constants/utils/getTxUrl";
import { getChainMeta } from "@/constants/chains";
import s from "./TxHistory.module.css";

/**
 * TxHistory — the trigger and the modal behind it, global tier.
 *
 * Self-contained the same way SwapSettings and ChartToggle are: it takes no data
 * and reports nothing back, so any page can drop one into a control row. It is
 * mounted on the Swap card and the Agent card, which are the two surfaces that
 * sign transactions, and both read the same log — a swap Luca executed for you is
 * still your swap, and splitting it per tab would ask the user to remember which
 * tab they were on.
 *
 * What it shows is what this browser signed through PlanReview for the connected
 * wallet on the connected chain. That is narrower than "your transactions" and
 * the header says so out loud, because a list that silently omits a swap made on
 * a phone is worse than no list: the reader would conclude the swap never
 * happened. See lib/v2/txLog.ts for the storage model.
 */

interface TxHistoryProps {
  /**
   * Appended to the trigger. The Agent card's header carries 30px circular
   * controls, so it passes `.triggerRound` from this module — the same escape
   * hatch ChartToggle offers, and the reason both variants live in the
   * component's own stylesheet rather than in each page's.
   */
  className?: string;
}

/** Two hands on a dial. An SVG rather than a glyph for the same reason
    ChartToggle draws its own: a font that lacks the character renders a box, and
    this control has no text beside it to fall back on. */
const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle
      cx="12"
      cy="12"
      r="9"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M12 7.5V12l3 2"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * How long ago, in the coarsest unit that still says something.
 *
 * Takes `now` as an argument rather than reading the clock itself so every row
 * in one render measures against the same instant — otherwise a list crossing a
 * minute boundary mid-map can show a later transaction as older than an earlier
 * one.
 */
function timeAgo(at: number, now: number): string {
  const sec = Math.max(0, Math.round((now - at) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

const shortHash = (hash: string) => `${hash.slice(0, 8)}…${hash.slice(-6)}`;

export default function TxHistory({ className }: TxHistoryProps) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);
  const { entries, clear, isConnected } = useTxLog();
  const { chainId } = useWalletV2();
  const chainName = getChainMeta(chainId)?.name;

  useEffect(() => {
    if (!open) return;
    /* Stamped when the panel opens, not on every render. The list is short and
       nobody watches "3m ago" tick over; re-reading the clock on each render
       would only make two rows disagree about what "now" is. */
    setNow(Date.now());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`${s.trigger} ${className ?? ""}`}
        onClick={() => setOpen(true)}
        aria-label="Transaction history"
        aria-haspopup="dialog"
      >
        <ClockIcon />
        {/* Absent rather than "0" while the log is empty — and absent on the
            first client render either way, because useTxLog loads in an effect.
            A count that appears a tick after paint is fine; one that differs
            between the server's HTML and the client's would not be. */}
        {entries.length > 0 && (
          <span className={`${s.count} tabular`}>{entries.length}</span>
        )}
      </button>

      {open && (
        <Portal>
          <div
            className={s.overlay}
            onClick={() => setOpen(false)}
            role="presentation"
          >
            <div
              className={s.modal}
              role="dialog"
              aria-modal="true"
              aria-label="Transaction history"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={s.mh}>
                <span className={s.mt}>Transactions</span>
                {entries.length > 0 && (
                  <button
                    type="button"
                    className={s.clear}
                    onClick={clear}
                    title="Delete this log from this device"
                  >
                    Clear
                  </button>
                )}
                <button
                  className={s.mx}
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {/* The scope, stated before the list rather than inferred from it.
                  Two things a reader cannot otherwise know: that this is a local
                  record and not a chain query, and which chain it covers — the
                  list empties on a network switch, and without this line that
                  reads as data loss. */}
              <p className={s.note}>
                Signed on this device
                {chainName ? ` on ${chainName}` : ""}. Not a chain history —
                transactions made elsewhere, or before this feature shipped,
                aren&apos;t here.
              </p>

              <div className={s.list}>
                {!isConnected ? (
                  <div className={s.empty}>
                    Connect a wallet to see what it has signed here.
                  </div>
                ) : entries.length === 0 ? (
                  <div className={s.empty}>
                    Nothing signed yet on this device
                    {chainName ? ` on ${chainName}` : ""}.
                  </div>
                ) : (
                  <ul className={s.rows}>
                    {entries.map((e) => {
                      const url = getChainTxUrl(chainId, e.hash);
                      return (
                        <li key={e.hash} className={s.row}>
                          <span
                            className={`${s.dot} ${e.status === "reverted" ? s.dotBad : ""}`}
                            aria-hidden="true"
                          />
                          <div className={s.body}>
                            <div className={s.rTitle}>{e.title}</div>
                            {e.detail && (
                              <div className={s.rDetail}>{e.detail}</div>
                            )}
                            {/* The hash is the row's only verifiable claim, so
                                it is always shown — as a link where the registry
                                knows the explorer, and as plain copyable text
                                where it does not. */}
                            {url ? (
                              <a
                                className={`${s.hash} tabular`}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {shortHash(e.hash)} ↗
                              </a>
                            ) : (
                              <span className={`${s.hash} tabular`}>
                                {shortHash(e.hash)}
                              </span>
                            )}
                          </div>
                          <div className={s.rMeta}>
                            <span className={s.time}>{timeAgo(e.at, now)}</span>
                            {e.status === "reverted" && (
                              <span
                                className={s.badBadge}
                                title="Broadcast and mined, but the contract rejected it — the gas was still spent"
                              >
                                Reverted
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
