"use client";

import { useEffect, useRef, useState } from "react";
import s from "./SwapSettings.module.css";

/**
 * Swap settings — the gear popover.
 *
 * Slippage and deadline are controlled by the parent (the Swap page owns them
 * so the quote's minimum-received reacts live). "Auto" is 0.5%; a custom value
 * over 5% shows a warning, since that's where sandwich risk gets real.
 */

export const AUTO_SLIPPAGE_BPS = 50;

interface SwapSettingsProps {
  slippageBps: number;
  onSlippage: (bps: number) => void;
  deadlineMin: number;
  onDeadline: (min: number) => void;
}

const PRESETS = [
  { label: "Auto", bps: AUTO_SLIPPAGE_BPS },
  { label: "0.1%", bps: 10 },
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
];

export default function SwapSettings({
  slippageBps,
  onSlippage,
  deadlineMin,
  onDeadline,
}: SwapSettingsProps) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isPreset = PRESETS.some((p) => p.bps === slippageBps);
  const label =
    slippageBps === AUTO_SLIPPAGE_BPS ? "Auto" : `${(slippageBps / 100).toFixed(2)}%`;
  const highSlippage = slippageBps > 500;

  const applyCustom = (v: string) => {
    setCustom(v);
    const n = parseFloat(v);
    if (Number.isFinite(n) && n > 0 && n <= 50) onSlippage(Math.round(n * 100));
  };

  return (
    <div className={s.wrap} ref={ref}>
      <button
        className={s.trigger}
        onClick={() => setOpen((o) => !o)}
        aria-label="Swap settings"
        aria-expanded={open}
      >
        <span className={s.gear}>⚙</span>
        <span className={s.triggerLabel}>{label}</span>
      </button>

      {open && (
        <div className={s.pop} role="dialog" aria-label="Swap settings">
          <div className={s.row}>Max slippage</div>
          <div className={s.presets}>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                className={`${s.preset} ${
                  slippageBps === p.bps && !custom ? s.presetOn : ""
                }`}
                onClick={() => {
                  setCustom("");
                  onSlippage(p.bps);
                }}
              >
                {p.label}
              </button>
            ))}
            <div className={`${s.customBox} ${!isPreset || custom ? s.customOn : ""}`}>
              <input
                className={s.customInput}
                inputMode="decimal"
                placeholder="0.0"
                value={custom}
                onChange={(e) => applyCustom(e.target.value.replace(/[^0-9.]/g, ""))}
                aria-label="Custom slippage percent"
              />
              <span className={s.pct}>%</span>
            </div>
          </div>

          {highSlippage && (
            <div className={s.warn}>
              High slippage — your trade may be front-run.
            </div>
          )}

          <div className={s.divider} />

          <div className={s.deadlineRow}>
            <span>Transaction deadline</span>
            <div className={s.deadlineInput}>
              <input
                className={s.customInput}
                inputMode="numeric"
                value={String(deadlineMin)}
                onChange={(e) => {
                  const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
                  onDeadline(Number.isFinite(n) && n > 0 ? n : 1);
                }}
                aria-label="Deadline minutes"
              />
              <span className={s.pct}>min</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
