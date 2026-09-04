"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePoolData } from "@/hooks/dex/usePoolData";
import { useV3Pools } from "@/hooks/dex/useV3Pools";
import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import { READ_ONLY_CHAIN_ID } from "@/config/provider";
import { discoveryChainIds } from "@/lib/dex/poolDiscovery";
import { DASH, usd, pct } from "@/lib/format/figures";
import type { ITradingPair } from "@/constants/types/dex";
import ChainTag from "./_components/ChainTag";
import DepositModal from "./_components/DepositModal";
import PairIcon from "./_components/PairIcon";
import PoolFilterModal from "./_components/PoolFilterModal";
import SeededTick from "./_components/SeededTick";
import {
  NO_FILTERS,
  activeFilterCount,
  applyPoolFilters,
  type PoolFilters,
} from "./filters";
import { feeLabel, volumeTitle } from "./format";
import s from "./pool.module.css";

/**
 * All pools — the Liquidity section's landing page.
 *
 * Moved here from /explore, where a table of every pool sat two clicks away
 * from the page that mints into them. Its own positions list moved down to
 * /pool/positions.
 *
 * BOTH VENUES, AND THE BADGE ON EACH ROW IS LOAD-BEARING
 *
 * This table listed V2 only, sitting above a New position button that mints V3 —
 * so every pool the protocol had actually opened was invisible in the product
 * that opened it, and the page read as "no pools indexed yet" to someone who had
 * just created one. The blocker was enumeration cost rather than missing data: V3
 * has no `allPairs`, so listing it means either scanning `PoolCreated` from a
 * deployment block nobody recorded, or sweeping `getPool(a, b, tier)` over a token
 * list. `useV3Pools` does the sweep and explains why that was the tractable half.
 *
 * Two hooks rather than one, merged here. They read different functions off
 * different factories and share only the price table and the volume window, both
 * of which already live in `@/lib/dex` — and both emit `ITradingPair` with
 * `version` set, so this file branches on one field and every row can say which
 * venue it belongs to. That badge matters more now than when it was a constant:
 * the two are separate markets in the same pair, and a trader picking a row needs
 * to know which one they are looking at.
 *
 * EVERY CHAIN WE DEPLOYED TO, AND THE TAG ON EACH ROW IS LOAD-BEARING TOO
 *
 * The figures were protocol-wide on one chain — `READ_ONLY_CHAIN_ID` — which was
 * right to refuse the *wallet's* chain and wrong to stop there. A factory is one
 * address on one chain, so a table whose contents changed when you switched
 * networks would be reporting on whatever happens to sit at those addresses
 * elsewhere; that argument rules out the wallet, not the other four deployments.
 * Under a heading that says "All pools" it left every pool we had opened on Base
 * Sepolia invisible. Both hooks now sweep `discoveryChains()` and each row carries
 * a `<ChainTag>` beside its fee — necessary, not decorative, because the same pair
 * at the same fee on two chains is two rows that are otherwise identical, and a
 * trader picking the wrong one is picking a pool their wallet cannot reach.
 *
 * DEPOSIT ON THE ROW, AND A BOX AND A PANEL ABOVE IT
 *
 * Everything above is why this list is long: both venues, three tiers, five
 * chains. It was also, until now, a list you could only read — the deposit flow
 * lived at /pool/new and every route into it started from nothing, so the reader
 * picked a pool here and was then asked to name its pair, tier and range again
 * from scratch. Worse, that form only mints V3 at the three tiers it offers, so a
 * V2 row had no path to a deposit at all. `DepositModal` takes the row it was
 * opened from, which is where all three of those answers already are.
 *
 * The box and the Filters panel are the other half of the same problem — a
 * cross-chain, cross-venue table is exactly the one you cannot scan by eye. Both
 * are in-memory (`filters.ts`), so neither is debounced and neither waits behind
 * an Apply button; the lending book's search box is debounced because each
 * keystroke there re-runs a paged server fetch, which does not apply to an array
 * two hooks have already swept.
 */

export default function PoolsPage() {
  const v2 = usePoolData();
  const v3 = useV3Pools();

  /* Gated on a discovery chain rather than the wallet's, for the reason in the
     header: nothing here is about where the visitor's wallet is pointed, and a
     wallet-chain gate would blank a public table because of it. Any one deployed
     chain opens the gate, since `discoveryChains()` is already filtered to
     deployments — the table is cross-chain, so one chain being unreadable is a
     missing block of rows, not an empty page. The read chain is named only when
     that set is empty, which is when there is genuinely nothing to enumerate. */
  const gate = useChainGate(discoveryChainIds()[0] ?? READ_ONLY_CHAIN_ID);

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<PoolFilters>(NO_FILTERS);
  const [panelOpen, setPanelOpen] = useState(false);
  /* The row a deposit is being made into, not a boolean — the modal is about one
     pool and needs the whole row, and holding the row is also what lets it stay
     open across a re-sweep. */
  const [depositInto, setDepositInto] = useState<ITradingPair | null>(null);

  /* Descending by TVL, unmeasurable last. `?? -1` rather than `?? 0`: a pool
     whose legs have no price is not a pool with no liquidity, and sorting it
     among the genuinely empty ones would say it was. One sort across both
     venues, not two blocks stacked — the reader is choosing where to trade a
     pair, and the deepest book is the answer to that whichever venue holds it. */
  const sortedPools = useMemo(
    () =>
      [...v2.pools, ...v3.pools].sort(
        (a, b) => (b.liquidity ?? -1) - (a.liquidity ?? -1),
      ),
    [v2.pools, v3.pools],
  );

  const visible = useMemo(
    () => applyPoolFilters(sortedPools, filters, query),
    [sortedPools, filters, query],
  );

  /* Either sweep still running counts as loading, so the table does not settle
     into a V2-only list and then reshuffle when the V3 sweep lands. */
  const loading = v2.loading || v3.loading;

  const filterCount = activeFilterCount(filters);
  const narrowed = visible.length !== sortedPools.length;
  const clearAll = () => {
    setQuery("");
    setFilters(NO_FILTERS);
  };

  /* After both hooks, never between them. */
  if (!gate.ready) return <ChainGate product="pool list" state={gate} />;

  return (
    <>
      {/* Rendered while loading as well, so it does not appear a beat after the
          rows and push the table down. Absent only when there is genuinely
          nothing to search. */}
      {loading || sortedPools.length > 0 ? (
        <div className={s.toolbar}>
          <div className={s.search}>
            <svg
              className={s.searchIcon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4.3-4.3" strokeLinecap="round" />
            </svg>
            <input
              className={s.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pools, tokens, networks or an address"
              aria-label="Search pools"
            />
            {query ? (
              <button
                type="button"
                className={s.searchClear}
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                ✕
              </button>
            ) : null}
          </div>
          {/* Only once something is hidden. A permanent "13 of 13 pools" is noise,
              and the number is only interesting as the answer to "what did I just
              filter out". */}
          {narrowed ? (
            <span className={s.resultNote}>
              {visible.length} of {sortedPools.length} pools
            </span>
          ) : null}
          <button
            className={`${s.filterBt} ${filterCount ? s.filterBtOn : ""}`}
            onClick={() => setPanelOpen(true)}
            aria-haspopup="dialog"
          >
            Filters
            {filterCount ? (
              <span className={s.filterCount}>{filterCount}</span>
            ) : null}
          </button>
        </div>
      ) : null}

      <div className={`${s.table} ${s.pools}`}>
        <div className={s.thead}>
          <span>Pool</span>
          <span className={s.right}>Price</span>
          <span className={s.right}>24h volume</span>
          <span className={s.right}>TVL</span>
          <span className={s.right}>APR</span>
          {/* Deliberately unlabelled: the column holds one button that says what it
              does, and "Action" above it would be a heading for nothing. */}
          <span />
        </div>
        {loading && sortedPools.length === 0 ? (
          [0, 1, 2].map((i) => (
            <div key={i} className={s.rowSkeleton}>
              <span className={s.skCircle} />
              <span className={s.skLine} />
            </div>
          ))
        ) : sortedPools.length === 0 ? (
          <div className={s.tEmpty}>No pools indexed yet.</div>
        ) : visible.length === 0 ? (
          /* Distinct from the line above it, because these are opposite facts: one
             says the sweep found nothing, the other says the reader's own box and
             checkboxes are hiding what it found. Answering the second with "No
             pools indexed yet" would report a bug that is not there. */
          <div className={s.tEmpty}>
            Nothing matches{query ? ` “${query}”` : " those filters"}.{" "}
            <button className={s.inlineClear} onClick={clearAll}>
              Clear
            </button>
          </div>
        ) : (
          visible.map((p) => (
            /* Keyed by chain as well as venue: a pool address is CREATE2-derived, so
               two chains can in principle hold the same address, and two rows with
               one key is a React reconciliation bug rather than a display one. */
            <div
              key={`${p.chainId}-${p.version}-${p.address}`}
              className={s.row}
            >
              {/* The pair cell now goes to /pool/[address] rather than out to the
                  block explorer. The explorer link did not disappear — it moved to
                  the copyable address chip on that page, beside the fee, the
                  balances and the depth curve, which is more than a row can carry.
                  Still not /pool/new: that form mints V3 at 500/3000/10000, so
                  prefilling it from a V2 pair and its bps-of-10000 fee would carry
                  over a tier that does not exist on the other side — which is what
                  the Deposit button at the end of the row is for instead.

                  `?chain=` because the address alone stopped identifying a pool the
                  moment this table went cross-chain. The detail page falls back to
                  matching on address when it is absent, so a pasted or bookmarked
                  URL from before still resolves. */}
              <Link
                className={s.pairCell}
                href={`/pool/${p.address}?chain=${p.chainId}`}
              >
                <div className={s.pair}>
                  <PairIcon symbol={p.token0.symbol} />
                  <PairIcon symbol={p.token1.symbol} />
                </div>
                <div>
                  <div className={s.pairName}>
                    {p.token0.symbol} / {p.token1.symbol}
                  </div>
                  <div className={s.pairFee}>
                    <span>
                      {feeLabel(p.feeBps)} · {p.version.toUpperCase()}
                    </span>
                    <ChainTag chainId={p.chainId} />
                    {/* Only when it is true, and no counterpart when it is
                        not: absence here means no deployment record, which
                        covers a stranger's pool and one of ours whose record
                        never got committed alike. Label off -- this line
                        already carries three text runs. See SeededTick. */}
                    {p.seeded ? <SeededTick /> : null}
                  </div>
                </div>
              </Link>
              <span className={`${s.right} tabular`}>
                {p.price !== null ? p.price.toFixed(p.price < 1 ? 6 : 4) : DASH}
              </span>
              <span
                className={`${s.right} tabular`}
                title={volumeTitle(p.volumeWindowSec)}
              >
                {usd(p.volume24h)}
              </span>
              <span className={`${s.right} tabular`}>{usd(p.liquidity)}</span>
              <span className={`${s.right} tabular`}>{pct(p.apr)}</span>
              {/* A sibling of the pair link, not inside it — nesting a button in an
                  anchor is invalid, and the click would have to be swallowed. */}
              <button
                className={s.depositBt}
                onClick={() => setDepositInto(p)}
                aria-label={`Deposit into ${p.token0.symbol} / ${p.token1.symbol} on chain ${p.chainId}`}
              >
                Deposit
              </button>
            </div>
          ))
        )}
      </div>

      {panelOpen ? (
        <PoolFilterModal
          /* The unfiltered rows, so a facet the current selection excludes is still
             offered — otherwise ticking one chain would remove every other chain's
             checkbox and there would be no way back. */
          pools={sortedPools}
          filters={filters}
          onChange={setFilters}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}

      {depositInto ? (
        <DepositModal
          pool={depositInto}
          onClose={() => setDepositInto(null)}
          /* Both sweeps, because the row that changed belongs to one of them and
             this component does not care which. Each collapses concurrent calls
             into a single pass, so the pair costs one refresh. */
          onDeposited={() => {
            v2.refetch();
            v3.refetch();
          }}
        />
      ) : null}
    </>
  );
}
