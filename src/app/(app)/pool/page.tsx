"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePoolData } from "@/hooks/dex/usePoolData";
import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import { READ_ONLY_CHAIN_ID } from "@/config/provider";
import { DASH, usd, pct } from "@/lib/format/figures";
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
 * V2, and the `· V2` badge on each row is load-bearing.
 *
 * The obvious objection is that this table sits above a New position button
 * that mints V3, so it ought to list V3 pools. It doesn't yet, and the reason is
 * enumeration cost, not missing data: V3 has no `allPairs`, so listing its pools
 * means either scanning `PoolCreated` from a deployment block nobody recorded, or
 * sweeping `getPool(a, b, tier)` over a token list for every fee tier. V2's
 * `allPairs(i)` needs neither — usePoolData reads any unknown token's metadata off
 * the chain — so V2 is the enumeration that works today. V3 joins this table once
 * one of those two sweeps is wired up.
 *
 * Every figure here is protocol-wide on READ_ONLY_CHAIN_ID, never the wallet's
 * chain: the V2 factory this enumerates — `getContracts(READ_ONLY_CHAIN_ID)
 * .v2Factory` — is one address on one chain, and a discovery table that changed
 * contents when you switched networks would be reporting on whatever happens to
 * sit at that address elsewhere.
 */

export default function PoolsPage() {
  const { pools, loading } = usePoolData();

  /* Gated on the read chain, not the wallet's, for the reason in the header
     above: the factory this enumerates lives at one address on one chain. A
     wallet-chain gate here would blank a public discovery table because of
     where the visitor's wallet happens to be pointed, and the read chain is not
     something they can switch — which is why the gate is told so. */
  const gate = useChainGate(READ_ONLY_CHAIN_ID);

  /* Descending by TVL, unmeasurable last. `?? -1` rather than `?? 0`: a pool
     whose legs have no price is not a pool with no liquidity, and sorting it
     among the genuinely empty ones would say it was. */
  const sortedPools = useMemo(
    () => [...pools].sort((a, b) => (b.liquidity ?? -1) - (a.liquidity ?? -1)),
    [pools],
  );

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
          <div key={p.address} className={s.row}>
            {/* The pair cell now goes to /pool/[address] rather than out to the
                block explorer. The explorer link did not disappear — it moved to
                the copyable address chip on that page, beside the fee, the
                balances and the depth curve, which is more than a row can carry.
                Still not /pool/new: that form mints V3 at 500/3000/10000, so
                prefilling it from a V2 pair and its bps-of-10000 fee would carry
                over a tier that does not exist on the other side. */}
            <Link className={s.pairCell} href={`/pool/${p.address}`}>
              <div className={s.pair}>
                <PairIcon symbol={p.token0.symbol} />
                <PairIcon symbol={p.token1.symbol} />
              </div>
              <div>
                <div className={s.pairName}>
                  {p.token0.symbol} / {p.token1.symbol}
                </div>
                <div className={s.pairFee}>{feeLabel(p.feeBps)} · V2</div>
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
