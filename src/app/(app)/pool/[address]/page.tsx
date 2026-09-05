"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import { READ_ONLY_CHAIN_ID } from "@/config/provider";
import { getChainAddressUrl } from "@/constants/utils/getTxUrl";
import type { ITradingPair } from "@/constants/types/dex";
import { usePoolData } from "@/hooks/dex/usePoolData";
import { useV3Pools } from "@/hooks/dex/useV3Pools";
import { usePoolTransactions } from "@/hooks/dex/usePoolTransactions";
import { pct, qty, usd } from "@/lib/format/figures";

import ChainTag from "../_components/ChainTag";
import PairIcon from "../_components/PairIcon";
import PoolBalanceBar from "../_components/PoolBalanceBar";
import PoolDepthChart from "../_components/PoolDepthChart";
import PoolTxnTable from "../_components/PoolTxnTable";
import SeededTick from "../_components/SeededTick";
import { feeLabel, volumeTitle } from "../format";
import { poolCurves } from "../poolCurve";
import s from "../pool.module.css";

/**
 * One pool, in detail — a V2 pair or a V3 pool.
 *
 * Reached from a row on /pool. The section's own chrome — the four-tile strip and
 * the tab bar — is suppressed for this route in layout.tsx, because both are
 * protocol-wide and this page is about a single pool; leaving them up would put
 * "Liquidity $4.2M across every pool" directly above "TVL $2.4M" for this one.
 *
 * WHAT IS HERE AND WHAT IS NOT
 *
 * Uniswap's equivalent page carries four chart tabs — price, volume, liquidity,
 * depth. Three of those are time series, and there is no indexer behind this app
 * holding per-block snapshots to draw them from: `usePoolData` deleted its
 * `volumeChange24h` and `liquidityChange24h` fields rather than ship zeroes for
 * the same reason. Depth is the one that needs no history, because a
 * constant-product pair's whole curve follows from the reserves it holds right
 * now — so that is the panel this page has, computed in `poolCurve.ts` against
 * the contract's own formula. The three missing tabs are not stubbed: an empty
 * chart frame labelled "Price" is a worse answer than not claiming to have one.
 *
 * WHICH IS ALSO WHY THE CURVE IS V2-ONLY
 *
 * "Follows from the reserves it holds right now" is a property of constant
 * product, not of pools in general. A V3 pool's two balances say what it holds
 * and nothing about what a trade costs, because the liquidity behind those
 * balances is spread across ticks this page never reads — so plotting the same
 * curve for one would be a fabricated chart rather than a missing one, and the
 * panel says so instead. Everything else here is venue-agnostic: TVL, volume,
 * fees, APR, the balance split and the transactions table are all measurements
 * that mean the same thing on both.
 *
 * NO NEW FETCH FOR THE POOL ITSELF
 *
 * Both enumerators cache at module scope and collapse concurrent calls, so
 * reading their lists and picking one pool out costs nothing beyond what the
 * table already paid — and it means this page and that table cannot disagree
 * about a figure. The one extra read is the transactions window, which is per
 * pool and has no other consumer.
 */

/** Reserves arrive as decimal strings of base units. */
const toBig = (raw: string | number): bigint | null => {
  try {
    return BigInt(String(raw));
  } catch {
    return null;
  }
};

export default function PoolDetailPage() {
  const params = useParams<{ address: string }>();
  const routeAddress = String(params?.address ?? "");

  /**
   * `?chain` — which chain's pool this URL means.
   *
   * An address stopped identifying a pool on its own once both enumerators went
   * cross-chain, so /pool's rows link with the chain attached. Read from
   * `window.location` in an effect rather than through `useSearchParams`, the same
   * call `trade/swap` makes: that hook forces a Suspense boundary on the route to
   * prerender, and this value is only ever a narrowing hint.
   *
   * Null is a working answer, not a fallback that guesses. A pool address is
   * CREATE2-derived from a factory address and two token addresses, all three of
   * which differ per chain, so an address matching pools on two chains at once is
   * a collision this app has no way to produce — which is what makes a URL from
   * before this parameter existed, or one pasted by hand, still resolve.
   */
  const [chainHint, setChainHint] = useState<number | null>(null);
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("chain");
    const id = Number(raw);
    setChainHint(raw && Number.isInteger(id) && id > 0 ? id : null);
  }, []);

  const v2 = usePoolData();
  const v3 = useV3Pools();
  const loading = v2.loading || v3.loading;

  /* Across both venues, because a row from either links here. Case-insensitive:
     a factory returns checksummed addresses while a URL carries whatever case
     was pasted into it, and `0xABC…` and `0xabc…` are the same pool. Nothing to
     disambiguate between the two lists — a V2 pair and a V3 pool are different
     contracts at different addresses — so `?chain` is the only tiebreak, and the
     first match stands when it names a chain that has no pool at this address. */
  const pool = useMemo(() => {
    const matches = [...v2.pools, ...v3.pools].filter(
      (p) => p.address.toLowerCase() === routeAddress.toLowerCase(),
    );
    if (matches.length === 0) return null;
    if (chainHint !== null) {
      return matches.find((p) => p.chainId === chainHint) ?? matches[0];
    }
    return matches[0];
  }, [v2.pools, v3.pools, routeAddress, chainHint]);

  const txns = usePoolTransactions(pool);

  /* This pool's own chain once it is known, and the hint before that so a direct
     load gates on the chain the URL asked for rather than on the read chain.
     Neither is the wallet's, for the reason /pool's header gives. */
  const gate = useChainGate(pool?.chainId ?? chainHint ?? READ_ONLY_CHAIN_ID);

  /* V2 only — see the header. `version` is checked before the fee so that a V3
     pool takes the venue branch rather than reading as a pool with no fee. */
  const curves = useMemo(() => {
    if (!pool || pool.version !== "v2" || pool.feeBps === null) return null;
    const reserve0 = toBig(pool.reserves.reserve0);
    const reserve1 = toBig(pool.reserves.reserve1);
    if (reserve0 === null || reserve1 === null) return null;
    return poolCurves(
      reserve0,
      reserve1,
      pool.token0.decimals,
      pool.token1.decimals,
      pool.feeBps,
    );
  }, [pool]);

  /* After every hook, never between them. */
  if (!gate.ready) return <ChainGate product="pool" state={gate} />;

  if (!pool) {
    /* Deliberately not `notFound()`. The pool list is fetched client-side and is
       empty on the first paint of a cold load, so a 404 here would fire on a
       pair that exists whenever someone opened the URL directly rather than
       clicking a row. Loading and missing are different answers and this
       distinguishes them. */
    if (loading) return <PoolSkeleton />;
    return (
      <div className={s.table}>
        <div className={s.tEmpty}>
          No pool at this address on any chain we read.{" "}
          <Link href="/pool" className={s.emptyLink}>
            Back to all pools
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <PoolHeader pool={pool} />

      <div className={s.detailGrid}>
        <div className={s.detailMain}>
          <div className={s.panel}>
            <div className={s.panelHead}>Trade cost by size</div>
            {curves ? (
              <PoolDepthChart
                sell0={curves.sell0}
                sell1={curves.sell1}
                symbol0={pool.token0.symbol}
                symbol1={pool.token1.symbol}
              />
            ) : pool.version === "v3" ? (
              /* Not a missing chart — a chart that would be wrong. The balances
                 in the sidebar are what the pool holds; a V3 pool's cost by size
                 depends on how that is distributed across ticks, which this page
                 does not read. */
              <div className={s.chartEmpty}>
                V3 liquidity is spread across tick ranges, so a single curve
                cannot describe this pool&apos;s trade cost.
              </div>
            ) : (
              /* Cost is fee plus curve, so without the fee there is no cost to
                 plot. The curve alone would understate every size by the fee,
                 which is the one direction a trader must not be misled in. */
              <div className={s.chartEmpty}>
                This pair does not report a swap fee, so its trade cost cannot
                be computed.
              </div>
            )}
          </div>

          <div className={s.panel}>
            <div className={s.panelHead}>Transactions</div>
            <PoolTxnTable
              txns={txns.txns}
              loading={txns.loading}
              error={txns.error}
              scannedBlocks={txns.scannedBlocks}
              scannedSec={txns.scannedSec}
              hasMore={txns.hasMore}
              chainId={pool.chainId}
              symbol0={pool.token0.symbol}
              symbol1={pool.token1.symbol}
            />
          </div>
        </div>

        <aside className={s.detailSide}>
          <div className={s.panel}>
            <div className={s.panelHead}>Stats</div>
            <div className={s.statList}>
              <SideStat label="TVL" value={usd(pool.liquidity)} />
              <SideStat
                label="24h volume"
                value={usd(pool.volume24h)}
                title={volumeTitle(pool.volumeWindowSec)}
              />
              <SideStat label="24h fees" value={usd(pool.fees24h, 2)} />
              <SideStat label="APR" value={pct(pool.apr)} />
              <SideStat
                label="Price"
                value={
                  pool.price === null
                    ? usd(null)
                    : `${qty(pool.price, pool.price < 1 ? 6 : 4)} ${
                        pool.token1.symbol
                      }`
                }
                /* The pool's own quote, not a market price — see ITradingPair.
                   Named here because a row labelled "Price" beside four USD
                   figures would otherwise read as one, and sourced because the
                   two venues derive it differently. */
                title={`${pool.token1.symbol} per ${pool.token0.symbol}, from ${
                  pool.version === "v3" ? "slot0" : "the reserves"
                }`}
              />
            </div>

            <PoolBalanceBar
              symbol0={pool.token0.symbol}
              symbol1={pool.token1.symbol}
              amount0={reserveFloat(pool, 0)}
              amount1={reserveFloat(pool, 1)}
              value0={pool.value0}
              value1={pool.value1}
            />
          </div>
        </aside>
      </div>
    </>
  );
}

/** Display units of one leg. Float, because it is only ever displayed — the
    arithmetic that matters stays in bigint inside poolCurve.ts. */
function reserveFloat(pool: ITradingPair, leg: 0 | 1): number {
  const raw = leg === 0 ? pool.reserves.reserve0 : pool.reserves.reserve1;
  const decimals = leg === 0 ? pool.token0.decimals : pool.token1.decimals;
  return Number(raw) / 10 ** decimals;
}

function PoolHeader({ pool }: { pool: ITradingPair }) {
  /* This pool's chain, not the read chain. An explorer URL built for the wrong
     chain resolves — to a page about an address that holds nothing there, which
     reads as a pool that was never deployed. */
  const explorer = getChainAddressUrl(pool.chainId, pool.address);

  return (
    <div className={s.detailHead}>
      <nav className={s.crumbs} aria-label="Breadcrumb">
        <Link href="/pool" className={s.crumb}>
          Pools
        </Link>
        <span className={s.crumbSep} aria-hidden="true">
          /
        </span>
        <span>
          {pool.token0.symbol} / {pool.token1.symbol}
        </span>
      </nav>

      <div className={s.detailTitle}>
        <div className={s.pair}>
          <PairIcon symbol={pool.token0.symbol} />
          <PairIcon symbol={pool.token1.symbol} />
        </div>
        <h1 className={s.detailH1}>
          {pool.token0.symbol} / {pool.token1.symbol}
        </h1>
        <span className={s.badge}>{pool.version.toUpperCase()}</span>
        <span className={s.detailFee}>{feeLabel(pool.feeBps)}</span>
        {/* Beside the venue and the fee, because it is the same kind of fact and
            the same kind of mistake to get wrong: the address chip below, the
            explorer link on it and the transactions table all describe this pool
            on this chain, and nothing else on the page says which one that is. */}
        <ChainTag chainId={pool.chainId} />
        {/* Labelled here, unlike the table's. This is the page a reader
            reaches when they are deciding rather than scanning, and it is
            where the word is worth its width. */}
        {pool.seeded ? <SeededTick label /> : null}
        <AddressChip address={pool.address} explorer={explorer} />

        <div className={s.detailActions}>
          {/* Prefills the swap form from this pair. The two addresses are this
              pool's chain's, which the form validates against the wallet's chain
              before selecting either — so a pool on a chain the wallet is not on
              leaves the form on its own defaults rather than selecting whatever
              those 20 bytes happen to be there. No chain is passed because the
              form has no chain parameter: switching networks is the wallet's, and
              a link cannot do it. */}
          <Link
            href={`/trade/swap?in=${pool.token0.address}&out=${pool.token1.address}`}
            className={`${s.bt} ${s.btWhite}`}
          >
            Swap
          </Link>
          {/* Prefilled with this pool's pair, because the reader has already
              named it: arriving bare meant the form fell through to its KLD/USDC
              default and silently replaced the pair the link was on. The FEE is
              a separate question and is only carried from a V3 pool — a V2
              pair's fee is bps-of-10000 and would name a tier that does not
              exist on the other side. `chain` is carried too, so a wallet on
              another network is told which one this pool is on instead of being
              shown the fallback pair with no explanation; a link cannot switch
              networks itself. */}
          <Link
            href={`/pool/new?token0=${pool.token0.address}&token1=${pool.token1.address}&chain=${pool.chainId}${
              pool.version === "v3" && pool.feeBps !== null
                ? `&fee=${pool.feeBps}`
                : ""
            }`}
            className={s.bt}
          >
            + Add liquidity
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * The pair address, copyable and linked.
 *
 * Both, because they answer different needs: the link is for looking at the
 * contract, the copy is for pasting it into a wallet or a script. Uniswap's page
 * puts the two on the same chip for the same reason.
 */
function AddressChip({
  address,
  explorer,
}: {
  address: string;
  explorer: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Denied permission, or an insecure origin. The address is on screen and
         selectable either way, so there is nothing to report. */
    }
  };

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  return (
    <span className={s.addrChip}>
      {explorer ? (
        <a
          className={s.addrLink}
          href={explorer}
          target="_blank"
          rel="noreferrer"
        >
          {short}
        </a>
      ) : (
        /* No explorer for this chain in chains.ts. The address still shows and
           still copies — a link to a guessed host is a dead end the reader
           cannot tell from a live one. */
        <span className={s.addrLink}>{short}</span>
      )}
      <button
        type="button"
        className={s.addrCopy}
        onClick={copy}
        aria-label={copied ? "Address copied" : "Copy pool address"}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function SideStat({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className={s.sideStat} title={title}>
      <span className={s.sideStatLabel}>{label}</span>
      <span className={`${s.sideStatValue} tabular`}>{value}</span>
    </div>
  );
}

/** Mirrors the finished layout's two columns, so the page does not jump when the
    first read lands. `.skLine` is `flex: 1` and needs a flex parent to take a
    height at all, which is what the `.rowSkeleton` wrappers are for. */
function PoolSkeleton() {
  return (
    <div className={s.detailGrid}>
      <div className={s.detailMain}>
        <div className={s.panel}>
          <div className={s.rowSkeleton}>
            <span className={s.skLine} />
          </div>
        </div>
        <div className={s.panel}>
          <div className={s.rowSkeleton}>
            <span className={s.skLine} />
          </div>
        </div>
      </div>
      <aside className={s.detailSide}>
        <div className={s.panel}>
          <div className={s.rowSkeleton}>
            <span className={s.skLine} />
          </div>
        </div>
      </aside>
    </div>
  );
}
