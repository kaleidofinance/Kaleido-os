"use client";

import type { ReactNode } from "react";

import ChainIcon from "@/components/v2/ChainIcon";
import { CHAINS_BY_ID } from "@/constants/chains";
import Portal from "./Portal";
import s from "@/app/(app)/(lending)/borrow.module.css";

type Range = { min: string; max: string };

/**
 * The filter panel for the borrow book — the same control the Pool page carries,
 * for the same reason: the book sweeps every deployment, so two rows can be the
 * same asset and rate on different chains, and finding one by eye is what a filter
 * replaces.
 *
 * TWO KINDS OF FILTER, one per column shape. Network, asset and status are
 * discrete, so they are facet checkboxes drawn from the rows themselves — an empty
 * list per facet means "no constraint", so unchecking the last box restores the
 * full book rather than emptying it. Amount, APR and term are continuous, so they
 * are min/max ranges instead, empty on either end meaning unbounded there. Both
 * kinds apply live off the in-memory book, so the count in the button behind the
 * modal moves as the controls change.
 *
 * The options come from the rows the caller passes, never from a registry or a
 * fixed status list, so a checkbox for a chain or status the sweep found nothing
 * on cannot exist and the panel needs no upkeep when a sixth chain appears.
 */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

/** Digits and a decimal point — the range inputs take numbers. */
const num = (v: string) => v.replace(/[^0-9.]/g, "");

export default function BorrowFilterModal({
  chains,
  symbols,
  statuses,
  selectedChains,
  selectedSymbols,
  selectedStatuses,
  amountRange,
  aprRange,
  termRange,
  onChains,
  onSymbols,
  onStatuses,
  onAmountRange,
  onAprRange,
  onTermRange,
  onClear,
  onClose,
}: {
  chains: number[];
  symbols: string[];
  statuses: string[];
  selectedChains: number[];
  selectedSymbols: string[];
  selectedStatuses: string[];
  amountRange: Range;
  aprRange: Range;
  termRange: Range;
  onChains: (next: number[]) => void;
  onSymbols: (next: string[]) => void;
  onStatuses: (next: string[]) => void;
  onAmountRange: (next: Range) => void;
  onAprRange: (next: Range) => void;
  onTermRange: (next: Range) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const row = (
    key: string,
    label: ReactNode,
    checked: boolean,
    onToggle: () => void,
  ) => (
    <label key={key} className={s.fRow}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className={s.fLabel}>{label}</span>
    </label>
  );

  const rangeRow = (
    label: string,
    unit: string,
    value: Range,
    onChange: (next: Range) => void,
  ) => (
    <div className={s.fBox}>
      <div className={s.fSection}>{label}</div>
      <div className={s.fRange}>
        <input
          className={s.fNum}
          inputMode="decimal"
          placeholder="Min"
          value={value.min}
          onChange={(e) => onChange({ ...value, min: num(e.target.value) })}
          aria-label={`${label} minimum`}
        />
        <span className={s.fDash}>&ndash;</span>
        <input
          className={s.fNum}
          inputMode="decimal"
          placeholder="Max"
          value={value.max}
          onChange={(e) => onChange({ ...value, max: num(e.target.value) })}
          aria-label={`${label} maximum`}
        />
        {unit ? <span className={s.fUnit}>{unit}</span> : null}
      </div>
    </div>
  );

  const anySelected =
    selectedChains.length > 0 ||
    selectedSymbols.length > 0 ||
    selectedStatuses.length > 0 ||
    !!(amountRange.min || amountRange.max) ||
    !!(aprRange.min || aprRange.max) ||
    !!(termRange.min || termRange.max);

  return (
    <Portal>
      <div className={s.overlay} onClick={onClose} role="presentation">
        <div
          className={s.filterModal}
          role="dialog"
          aria-modal="true"
          aria-label="Filter the book"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={s.fHead}>
            <span className={s.fTitle}>Filter the book</span>
            <button className={s.fClose} onClick={onClose} aria-label="Close">
              &#10005;
            </button>
          </div>

          {chains.length > 1 && (
            <div className={s.fBox}>
              <div className={s.fSection}>Network</div>
              {chains.map((id) => {
                const meta = CHAINS_BY_ID[id];
                return row(
                  `c${id}`,
                  <span className={s.chainTag}>
                    <ChainIcon
                      id={meta?.iconId}
                      size={14}
                      variant="branded"
                      fallback={
                        <i
                          className={s.chainDot}
                          style={meta ? { background: meta.color } : undefined}
                        />
                      }
                    />
                    {meta?.shortName ?? `Chain ${id}`}
                  </span>,
                  selectedChains.includes(id),
                  () => onChains(toggle(selectedChains, id)),
                );
              })}
            </div>
          )}

          {symbols.length > 1 && (
            <div className={s.fBox}>
              <div className={s.fSection}>Asset</div>
              {symbols.map((sym) =>
                row(
                  `a${sym}`,
                  sym,
                  selectedSymbols.includes(sym),
                  () => onSymbols(toggle(selectedSymbols, sym)),
                ),
              )}
            </div>
          )}

          {statuses.length > 1 && (
            <div className={s.fBox}>
              <div className={s.fSection}>Status</div>
              {statuses.map((st) =>
                row(
                  `s${st}`,
                  st,
                  selectedStatuses.includes(st),
                  () => onStatuses(toggle(selectedStatuses, st)),
                ),
              )}
            </div>
          )}

          {rangeRow("Amount", "", amountRange, onAmountRange)}
          {rangeRow("APR", "%", aprRange, onAprRange)}
          {rangeRow("Term", "days left", termRange, onTermRange)}

          {anySelected && (
            <button className={s.fClear} onClick={onClear}>
              Clear filters
            </button>
          )}
        </div>
      </div>
    </Portal>
  );
}
