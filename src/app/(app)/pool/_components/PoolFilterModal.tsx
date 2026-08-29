"use client";

import type { ReactNode } from "react";
import type { ITradingPair } from "@/constants/types/dex";
import {
  NO_FILTERS,
  poolFacets,
  toggle,
  type PoolFilters,
} from "../filters";
import { feeLabel } from "../format";
import ChainTag from "./ChainTag";
import PoolModal from "./PoolModal";
import s from "../pool.module.css";

/**
 * The filter panel for the pools table.
 *
 * Every option comes from the rows themselves via `poolFacets`, not from
 * `FEE_TIERS` or the chain registry. A checkbox for a tier no pool uses, or for a
 * chain the sweep found nothing on, is a control whose only possible outcome is an
 * empty table — and on a testnet where deployments land one at a time, most of the
 * registry is that. It also means this panel needs no maintenance when a sixth
 * chain or a fourth tier appears.
 *
 * Applied live rather than behind an Apply button: the table is already in memory,
 * so there is nothing to wait for, and the count in the button behind the modal
 * moves as the boxes are ticked.
 *
 * An empty list for a facet means "no constraint" — see `PoolFilters`. That is why
 * unchecking the last chain restores the full table instead of emptying it, which
 * is the behaviour someone using these to narrow expects.
 */
export default function PoolFilterModal({
  pools,
  filters,
  onChange,
  onClose,
}: {
  /** Every row before filtering — the options are drawn from these. */
  pools: readonly ITradingPair[];
  filters: PoolFilters;
  onChange: (next: PoolFilters) => void;
  onClose: () => void;
}) {
  const facets = poolFacets(pools);

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

  return (
    <PoolModal title="Filter pools" onClose={onClose}>
      {/* Only offered when both venues are actually listed. With one venue in the
          table the control is a checkbox that either changes nothing or empties the
          list, which is not a filter. */}
      {facets.venues.length > 1 ? (
        <div className={s.mBox}>
          <div className={s.bl}>Venue</div>
          {facets.venues.map((v) =>
            row(
              v,
              <>
                {v.toUpperCase()}
                <span className={s.fNote}>
                  {v === "v2"
                    ? "Constant-product pairs"
                    : "Concentrated liquidity"}
                </span>
              </>,
              filters.venues.includes(v),
              () => onChange({ ...filters, venues: toggle(filters.venues, v) }),
            ),
          )}
        </div>
      ) : null}

      {facets.chainIds.length > 1 ? (
        <div className={s.mBox}>
          <div className={s.bl}>Network</div>
          {facets.chainIds.map((id) =>
            row(
              String(id),
              /* The same tag the row carries, so the checkbox and the thing it
                 hides are recognisably the same network. */
              <>
                <ChainTag chainId={id} />
                <span className={s.fNote}>
                  {pools.filter((p) => p.chainId === id).length} pools
                </span>
              </>,
              filters.chainIds.includes(id),
              () =>
                onChange({ ...filters, chainIds: toggle(filters.chainIds, id) }),
            ),
          )}
        </div>
      ) : null}

      {facets.feeBps.length > 1 ? (
        <div className={s.mBox}>
          <div className={s.bl}>Fee tier</div>
          {facets.feeBps.map((bps) =>
            row(
              String(bps),
              <>
                {feeLabel(bps)}
                <span className={s.fNote}>
                  {pools.filter((p) => p.feeBps === bps).length} pools
                </span>
              </>,
              filters.feeBps.includes(bps),
              () =>
                onChange({ ...filters, feeBps: toggle(filters.feeBps, bps) }),
            ),
          )}
        </div>
      ) : null}

      <div className={s.mBox}>
        <div className={s.bl}>Liquidity</div>
        {row(
          "hideEmpty",
          <>
            Hide empty pools
            {/* Says what it does, because "empty" is a measurement here and not a
                guess: a pool whose legs have no USD price reads as "—" in the TVL
                column and is kept, since hiding it would assert something the
                table does not know. */}
            <span className={s.fNote}>
              Only pools measured at zero — unpriced ones stay
            </span>
          </>,
          filters.hideEmpty,
          () => onChange({ ...filters, hideEmpty: !filters.hideEmpty }),
        )}
      </div>

      <div className={s.fActions}>
        <button
          className={s.preset}
          onClick={() => onChange(NO_FILTERS)}
          disabled={
            filters.venues.length === 0 &&
            filters.chainIds.length === 0 &&
            filters.feeBps.length === 0 &&
            !filters.hideEmpty
          }
        >
          Reset
        </button>
        <button className={`${s.preset} ${s.presetOn}`} onClick={onClose}>
          Done
        </button>
      </div>
    </PoolModal>
  );
}
