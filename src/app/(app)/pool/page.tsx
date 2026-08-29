"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePoolData } from "@/hooks/dex/usePoolData";
import { useV3Pools } from "@/hooks/dex/useV3Pools";
import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import { READ_ONLY_CHAIN_ID } from "@/config/provider";
import { discoveryChainIds } from "@/lib/dex/poolDiscovery";
import { DASH, usd, pct } from "@/lib/format/figures";
import ChainTag from "./_components/ChainTag";
import PairIcon from "./_components/PairIcon";
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

  /* Either sweep still running counts as loading, so the table does not settle
     into a V2-only list and then reshuffle when the V3 sweep lands. */
  const loading = v2.loading || v3.loading;

  /* After both hooks, never between them. */
  if (!gate.ready) return <ChainGate product="pool list" state={gate} />;

  return (
    <div className={`${s.table} ${s.pools}`}>
      <div className={s.thead}>
        <span>Pool</span>
        <span className={s.right}>Price</span>
        <span className={s.right}>24h volume</span>
        <span className={s.right}>TVL</span>
        <span className={s.right}>APR</span>
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
      ) : (
        sortedPools.map((p) => (
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
                over a tier that does not exist on the other side.

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
          </div>
        ))
      )}
    </div>
  );
}
