"use client";

import type { ReactNode } from "react";

import ChainIcon from "@/components/v2/ChainIcon";
import { CHAINS_BY_ID } from "@/constants/chains";
import Portal from "./Portal";
import s from "@/app/(app)/(lending)/borrow.module.css";

/**
 * The filter panel for the borrow book — the same control the Pool page carries,
 * for the same reason: the book now sweeps every deployment, so two rows can be
 * the same asset and rate on different chains, and finding one by eye is what a
 * filter replaces.
 *
 * Facets, not selections. An empty list for a facet means "no constraint", so
 * unchecking the last box restores the full book rather than emptying it — the
 * behaviour someone narrowing expects. The options come from the rows the caller
 * passes, never from the chain registry or a token list, so a checkbox for a
 * chain the sweep found nothing on cannot exist, and the panel needs no upkeep
 * when a sixth chain appears.
 *
 * Applied live: the book is already in memory, so the count in the button behind
 * the modal moves as the boxes are ticked.
 */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export default function BorrowFilterModal({
  chains,
  symbols,
  selectedChains,
  selectedSymbols,
  onChains,
  onSymbols,
  onClear,
  onClose,
}: {
  chains: number[];
  symbols: string[];
  selectedChains: number[];
  selectedSymbols: string[];
  onChains: (next: number[]) => void;
  onSymbols: (next: string[]) => void;
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

  const anySelected = selectedChains.length > 0 || selectedSymbols.length > 0;

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
              ✕
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
