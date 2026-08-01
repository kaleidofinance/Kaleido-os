"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useV3Positions, type V3Position } from "@/hooks/dex/useV3Positions";
import { usePoolV3 } from "@/hooks/v2/usePoolV3";
import { ABSTRACT_TOKENS } from "@/constants/tokens";
import { tickToPrice } from "@/constants/utils/v3Math";
import s from "./pool.module.css";

const decimalsFor = (address: string) =>
  ABSTRACT_TOKENS.find((t) => t.address?.toLowerCase() === address?.toLowerCase())
    ?.decimals ?? 18;

const symbolFor = (address: string) =>
  ABSTRACT_TOKENS.find((t) => t.address?.toLowerCase() === address?.toLowerCase())
    ?.symbol ?? `${address?.slice(0, 6)}…`;

/** Current-tick lookups, keyed by position — fetched once per position on mount. */
function useCurrentTicks(positions: V3Position[]) {
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
        decimalsFor(p.token0),
        decimalsFor(p.token1),
      ).then((r) => {
        if (!cancelled) setTicks((prev) => ({ ...prev, [p.tokenId]: r?.tick ?? null }));
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
  const cur = currentTick !== null ? tickToPrice(currentTick, decimals0, decimals1) : null;

  // Position the marker within a padded window around [lo, hi] on a log scale
  // — V3 ranges are naturally log-spaced, and this keeps a tight range from
  // collapsing to a single pixel.
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);
  const pad = Math.max((logHi - logLo) * 0.4, 0.05);
  const windowLo = logLo - pad;
  const windowHi = logHi + pad;
  const pct = (v: number) =>
    Math.max(0, Math.min(100, ((Math.log(v) - windowLo) / (windowHi - windowLo)) * 100));

  const bandLeft = pct(lo);
  const bandRight = 100 - pct(hi);
  const markerPct = cur !== null ? pct(cur) : null;
  const inRange = cur !== null && cur >= lo && cur <= hi;

  const fmt = (v: number) => (v >= 1000 ? v.toFixed(0) : v >= 1 ? v.toFixed(4) : v.toFixed(6));

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

export default function PoolPage() {
  const { positions, loading, collectFees, removeLiquidity, refresh } = useV3Positions();
  const currentTicks = useCurrentTicks(positions);
  const [busy, setBusy] = useState<string | null>(null);

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

  if (loading && positions.length === 0) {
    return (
      <div className={s.cards}>
        {[0, 1].map((i) => (
          <div key={i} className={s.card} style={{ opacity: 0.5 }}>
            <div className={s.cardTop}>
              <div className={s.pair}>
                <span className={s.tki} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (withActive.length === 0) {
    return (
      <div className={s.empty}>
        <div className={s.emptyTitle}>No liquidity positions yet.</div>
        <div className={s.emptySub}>
          Provide liquidity to a pool to start earning trading fees.
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
                <span className={s.tki}>{symbolFor(p.token0).slice(0, 3)}</span>
                <span className={s.tki}>{symbolFor(p.token1).slice(0, 3)}</span>
              </div>
              <div>
                <div className={s.pairName}>
                  {symbolFor(p.token0)} / {symbolFor(p.token1)}
                </div>
                <div className={s.pairFee}>V3 · {(p.fee / 10000).toFixed(2)}% fee · #{p.tokenId}</div>
              </div>
              <span className={`${s.badge} ${p.inRange ? "" : s.out}`}>
                {p.inRange ? "In range" : "Out of range"}
              </span>
            </div>

            <RangeBar
              tickLower={p.tickLower}
              tickUpper={p.tickUpper}
              currentTick={currentTicks[p.tokenId] ?? null}
              decimals0={decimalsFor(p.token0)}
              decimals1={decimalsFor(p.token1)}
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
                {busy === `collect-${p.tokenId}` ? "Collecting…" : "Collect fees"}
              </button>
              <button
                className={s.actBtn}
                disabled={busy === `remove-${p.tokenId}`}
                onClick={() => onRemove(p)}
              >
                {busy === `remove-${p.tokenId}` ? "Removing…" : "Remove liquidity"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
