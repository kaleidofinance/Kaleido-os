"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useV3Positions, type V3Position } from "@/hooks/dex/useV3Positions";
import { usePoolV3 } from "@/hooks/v2/usePoolV3";
import { decimalsForAddress, symbolForAddress } from "@/constants/tokens";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import { tickToPrice } from "@/constants/utils/v3Math";
import PairIcon from "../_components/PairIcon";
import s from "../pool.module.css";

/**
 * Your positions — the wallet-scoped half of the Liquidity section.
 *
 * Moved here from /pool when the all-pools table took the section's landing
 * slot. The two are deliberately separate routes rather than client state: the
 * repo's convention (see pool/layout.tsx, trade/layout.tsx) is that a tab bar
 * navigates, so both halves are linkable and the back button works.
 *
 * V3 only, and read through the injected wallet — `useV3Positions` needs an
 * owner to enumerate NFTs from. That makes this the one page in the section a
 * visitor with no wallet cannot see anything on, which the empty state says
 * outright rather than claiming they hold no positions.
 */

/**
 * Display-only decimals for a position's token.
 *
 * The `?? 18` is a deliberate, visible guess and only safe because these feed
 * tickToPrice for a rendered price label. Never reuse this shape to size a
 * transfer: an unregistered 6-decimal token read as 18 is off by 10^12.
 */
const decimalsFor = (chainId: number | undefined, address: string) =>
  decimalsForAddress(chainId, address) ?? 18;

/** Current-tick lookups, keyed by position — fetched once per position on mount. */
function useCurrentTicks(positions: V3Position[], chainId: number | undefined) {
  const { getCurrentTick } = usePoolV3();
  const [ticks, setTicks] = useState<Record<string, number | null>>({});

  useEffect(() => {
    let cancelled = false;
    positions.forEach((p) => {
      if (p.tokenId in ticks) return;
      getCurrentTick(
        p.token0,
        p.token1,
        p.fee,
        decimalsFor(chainId, p.token0),
        decimalsFor(chainId, p.token1),
      ).then((r) => {
        if (!cancelled)
          setTicks((prev) => ({ ...prev, [p.tokenId]: r?.tick ?? null }));
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.map((p) => p.tokenId).join(",")]);

  return ticks;
}

function RangeBar({
  tickLower,
  tickUpper,
  currentTick,
  decimals0,
  decimals1,
}: {
  tickLower: number;
  tickUpper: number;
  currentTick: number | null;
  decimals0: number;
  decimals1: number;
}) {
  const lo = tickToPrice(tickLower, decimals0, decimals1);
  const hi = tickToPrice(tickUpper, decimals0, decimals1);
  const cur =
    currentTick !== null
      ? tickToPrice(currentTick, decimals0, decimals1)
      : null;

  // Position the marker within a padded window around [lo, hi] on a log scale
  // — V3 ranges are naturally log-spaced, and this keeps a tight range from
  // collapsing to a single pixel.
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);
  const pad = Math.max((logHi - logLo) * 0.4, 0.05);
  const windowLo = logLo - pad;
  const windowHi = logHi + pad;
  const pct = (v: number) =>
    Math.max(
      0,
      Math.min(100, ((Math.log(v) - windowLo) / (windowHi - windowLo)) * 100),
    );

  const bandLeft = pct(lo);
  const bandRight = 100 - pct(hi);
  const markerPct = cur !== null ? pct(cur) : null;
  const inRange = cur !== null && cur >= lo && cur <= hi;

  const fmt = (v: number) =>
    v >= 1000 ? v.toFixed(0) : v >= 1 ? v.toFixed(4) : v.toFixed(6);

  return (
    <div className={s.range}>
      <div className={s.rangeBar}>
        <div
          className={s.rangeBand}
          style={{ left: `${bandLeft}%`, right: `${bandRight}%` }}
        />
        {markerPct !== null && (
          <div
            className={`${s.rangeMark} ${inRange ? "" : s.out}`}
            style={{ left: `${markerPct}%` }}
          />
        )}
      </div>
      <div className={s.rangeLabels}>
        <span>{fmt(lo)}</span>
        <span className={inRange ? "" : s.out}>
          {cur !== null ? (inRange ? "in range" : "out of range") : "…"}
        </span>
        <span>{fmt(hi)}</span>
      </div>
    </div>
  );
}

export default function PositionsPage() {
  const { positions, loading, collectFees, removeLiquidity, refresh } =
    useV3Positions();
  const { chainId, isConnected } = useWalletV2();
  const currentTicks = useCurrentTicks(positions, chainId);
  const [busy, setBusy] = useState<string | null>(null);
  const gate = useChainGate();

  // Bound to this chain so a position's raw addresses resolve against the right
  // registry — the same address means a different token on a different chain.
  const symbolFor = (address: string) => symbolForAddress(chainId, address);

  const withActive = positions.filter((p) => Number(p.liquidity) > 0);

  const onCollect = async (tokenId: string) => {
    setBusy(`collect-${tokenId}`);
    try {
      await collectFees(tokenId);
      toast.success("Fees collected");
      refresh();
    } catch (err) {
      console.error("[v2/pool] collect failed", err);
      toast.error("Couldn't collect fees");
    } finally {
      setBusy(null);
    }
  };

  const onRemove = async (p: V3Position) => {
    setBusy(`remove-${p.tokenId}`);
    try {
      await removeLiquidity(p.tokenId, p.liquidity);
      toast.success("Liquidity removed");
      refresh();
    } catch (err) {
      console.error("[v2/pool] remove failed", err);
      toast.error("Couldn't remove liquidity");
    } finally {
      setBusy(null);
    }
  };

  /* The third fact the two empty states below do not cover: a connected wallet
     on a chain with no PositionManager. `useV3Positions` reads nothing there, so
     "No liquidity positions yet." would be the same unchecked claim the comment
     further down rejects for the no-wallet case.
     Checked before the skeleton, not after: the gate is derived from the
     registry, so it is already known, and showing a loading state for a read
     that will never happen would be a fabricated wait. */
  if (!gate.ready) {
    return <ChainGate product="liquidity positions" state={gate} />;
  }

  if (loading && positions.length === 0) {
    return (
      <div className={s.cards}>
        {[0, 1].map((i) => (
          <div key={i} className={s.card} style={{ opacity: 0.5 }}>
            <div className={s.cardTop}>
              <div className={s.pair}>
                {/* Bare `.tki`, not a PairIcon — here the grey plate is the
                    point. `.tkiArt` drops it for real artwork, which would leave
                    the skeleton with nothing to draw. */}
                <span className={s.tki} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* Two different empty states, because they are two different facts. With no
     wallet `useV3Positions` returns [] without asking the chain anything, so
     "no positions yet" would be a claim we never checked — and the fix for it
     is a connect, not a deposit. */
  if (withActive.length === 0) {
    return (
      <div className={s.empty}>
        <div className={s.emptyTitle}>
          {isConnected
            ? "No liquidity positions yet."
            : "Connect a wallet to see your positions."}
        </div>
        <div className={s.emptySub}>
          {isConnected
            ? "Provide liquidity to a pool to start earning trading fees."
            : "Positions are held as NFTs in your wallet, so there is nothing to read until one is connected."}{" "}
          Browse{" "}
          <Link href="/pool" className={s.emptyLink}>
            all pools
          </Link>{" "}
          or{" "}
          <Link href="/pool/new" className={s.emptyLink}>
            open a position
          </Link>
          .
        </div>
      </div>
    );
  }

  return (
    <div className={s.cards}>
      {withActive.map((p) => {
        const owedTotal = Number(p.tokensOwed0) + Number(p.tokensOwed1);
        return (
          <div key={p.tokenId} className={s.card}>
            <div className={s.cardTop}>
              <div className={s.pair}>
                <PairIcon symbol={symbolFor(p.token0)} />
                <PairIcon symbol={symbolFor(p.token1)} />
              </div>
              <div>
                <div className={s.pairName}>
                  {symbolFor(p.token0)} / {symbolFor(p.token1)}
                </div>
                <div className={s.pairFee}>
                  V3 · {(p.fee / 10000).toFixed(2)}% fee · #{p.tokenId}
                </div>
              </div>
              <span className={`${s.badge} ${p.inRange ? "" : s.out}`}>
                {p.inRange ? "In range" : "Out of range"}
              </span>
            </div>

            <RangeBar
              tickLower={p.tickLower}
              tickUpper={p.tickUpper}
              currentTick={currentTicks[p.tokenId] ?? null}
              decimals0={decimalsFor(chainId, p.token0)}
              decimals1={decimalsFor(chainId, p.token1)}
            />

            <div className={s.stats}>
              <div className={s.stat}>
                <span className={s.statLabel}>Liquidity</span>
                <span className={`${s.statValue} tabular`}>{p.liquidity}</span>
              </div>
              <div className={s.stat}>
                <span className={s.statLabel}>Unclaimed fees</span>
                <span className={`${s.statValue} tabular`}>
                  {p.tokensOwed0} {symbolFor(p.token0)} + {p.tokensOwed1}{" "}
                  {symbolFor(p.token1)}
                </span>
              </div>
            </div>

            <div className={s.actions}>
              <button
                className={`${s.actBtn} ${s.primary}`}
                disabled={owedTotal === 0 || busy === `collect-${p.tokenId}`}
                onClick={() => onCollect(p.tokenId)}
              >
                {busy === `collect-${p.tokenId}`
                  ? "Collecting…"
                  : "Collect fees"}
              </button>
              <button
                className={s.actBtn}
                disabled={busy === `remove-${p.tokenId}`}
                onClick={() => onRemove(p)}
              >
                {busy === `remove-${p.tokenId}`
                  ? "Removing…"
                  : "Remove liquidity"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
