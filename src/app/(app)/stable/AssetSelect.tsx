"use client";

import { useState } from "react";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import Portal from "@/components/v2/Portal";
import f from "./form.module.css";

/**
 * The asset chooser for the Stable forms — mint's collateral, redeem's payout.
 *
 * It replaces a row of bare chips that named the asset and nothing else. The one
 * fact that decides which collateral to spend, how much of each you hold, was
 * absent from the choice and only appeared as the balance line under the input,
 * for the one already selected. This is the pattern the swap and borrow forms
 * use: a single pill in the amount field that opens a modal listing every option
 * with its wallet balance, so the choice is made with the balances in view.
 *
 * The balances come from the caller (useStablecoin already holds them, keyed by
 * symbol) rather than being re-read here, so the list stays in step with the
 * balance line the form shows and the modal needs no fetch of its own.
 */
type Option = { symbol: string; balance: string };

export default function AssetSelect({
  value,
  options,
  label = "Select an asset",
  onChange,
}: {
  value: string;
  options: Option[];
  label?: string;
  onChange: (symbol: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.symbol === value) ?? options[0];
  const fmt = (b: string) =>
    Number(b).toLocaleString(undefined, { maximumFractionDigits: 4 });

  return (
    <>
      <button
        type="button"
        className={f.asSel}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span
          className={`${f.tki} ${
            selected && hasTokenIcon(selected.symbol) ? f.tkiArt : ""
          }`}
        >
          <TokenIcon
            symbol={selected?.symbol ?? ""}
            size={28}
            fallback={(selected?.symbol ?? "?").slice(0, 3)}
          />
        </span>
        {selected?.symbol ?? "Select"}
        <span className={f.asSelChev} aria-hidden="true">
          {"▾"}
        </span>
      </button>

      {open && (
        <Portal>
          <div
            className={f.asOverlay}
            onClick={() => setOpen(false)}
            role="presentation"
          >
            <div
              className={f.asModal}
              role="dialog"
              aria-modal="true"
              aria-label={label}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={f.asHead}>
                <span className={f.asTitle}>{label}</span>
                <button
                  className={f.asClose}
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  {"✕"}
                </button>
              </div>
              <div className={f.asList}>
                {options.map((o) => (
                  <button
                    key={o.symbol}
                    type="button"
                    className={`${f.asRow} ${
                      o.symbol === value ? f.asRowOn : ""
                    }`}
                    onClick={() => {
                      onChange(o.symbol);
                      setOpen(false);
                    }}
                  >
                    <span
                      className={`${f.tki} ${
                        hasTokenIcon(o.symbol) ? f.tkiArt : ""
                      }`}
                    >
                      <TokenIcon
                        symbol={o.symbol}
                        size={24}
                        fallback={o.symbol.slice(0, 3)}
                      />
                    </span>
                    <span className={f.asRowSym}>{o.symbol}</span>
                    <span className={f.asRowBal}>
                      {fmt(o.balance)}
                      {o.symbol === value ? (
                        <span className={f.asRowTick} aria-hidden="true">
                          {"✓"}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
