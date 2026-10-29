"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useMarketStats } from "@/hooks/market/useMarketStats";
import Nav from "@/components/v2/Nav";
import { StatStrip, Stat } from "@/components/v2/StatStrip";
import { usd, qty, pct } from "@/lib/format/figures";
import type { AnalyticsOverview } from "@/lib/analytics/overview";
import type { DailyPoint } from "@/lib/analytics/timeseries";
import { ANALYTICS_MAINNET_CHAIN_IDS, EXTERNAL_MARKET_CHAIN_IDS } from "@/lib/analytics/scope";
import { TimeChart } from "./_components/TimeChart";
import s from "./analytics.module.css";

/**
 * The public analytics page — headline KPIs across every Kaleido product, from
 * /api/analytics/overview. Near-real-time: react-query re-fetches every 30s as
 * the ledgers climb. Each domain renders what it has; an unavailable source
 * shows the "—" every tile falls back to, never a confident zero. Sensitive/ops
 * metrics are NOT here — those belong to the admin section (Phase 3).
 */
export default function AnalyticsPage() {
  const [network, setNetwork] = useState("all");
  useEffect(() => { const asked = new URLSearchParams(window.location.search).get("chain"); if (asked === "5042" || asked === "4663" || asked === "56") setNetwork(asked); }, []);
  const lending = useMarketStats(network === "all" ? [...ANALYTICS_MAINNET_CHAIN_IDS] : [Number(network)]);
  const { data } = useQuery<AnalyticsOverview>({
    queryKey: ["analytics-overview", network],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/overview?chain=${network}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`overview ${res.status}`);
      return (await res.json()) as AnalyticsOverview;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { data: ts } = useQuery<{ days: number; series: DailyPoint[] | null }>({
    queryKey: ["analytics-timeseries", network],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/timeseries?days=30&chain=${network}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`timeseries ${res.status}`);
      return (await res.json()) as { days: number; series: DailyPoint[] | null };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const series = ts?.series ?? [];
  const sum = (f: (d: DailyPoint) => number) => series.reduce((a, d) => a + f(d), 0);

  const t = data?.trading;
  const g = data?.growth;
  const l = data?.luca;
  const p = data?.points;
  const externalMarkets = data?.externalMarkets ?? [];
  const externalChains = EXTERNAL_MARKET_CHAIN_IDS.filter((chainId) => network === "all" || Number(network) === chainId);

  const bridges =
    t && (t.cctpBridgeCount != null || t.routeBridgeCount != null)
      ? (t.cctpBridgeCount ?? 0) + (t.routeBridgeCount ?? 0)
      : null;

  const topSources = p
    ? Object.entries(p.bySource)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
    : [];

  return (
    <>
      <Nav />
      <main className={s.wrap}>
        <div className={s.head}>
          <h1 className={s.h1}>Analytics</h1>
          <div className={s.networks} role="group" aria-label="Filter analytics by network">
            {[["all", "All mainnets"], ["5042", "Arc"], ["4663", "Robinhood"], ["56", "BNB Smart Chain"]].map(([value, label]) => (
              <button key={value} type="button" aria-pressed={network === value}
                className={`${s.network} ${network === value ? s.networkOn : ""}`}
                onClick={() => { setNetwork(value); const url = new URL(window.location.href); url.searchParams.set("chain", value); window.history.replaceState(null, "", url); }}>
                {label}
              </button>
            ))}
          </div>
          <p className={s.sub}>
            <span className={s.live}>
              <span className={s.dot} aria-hidden /> Live
            </span>{" "}
            across every Kaleido product · refreshes every 30s
          </p>
        </div>

        <section className={s.section}>
          <h2 className={s.h2}>Kaleido activity · all time</h2>
          <StatStrip>
            <Stat label="Total volume" value={usd(t ? t.volumeUsd : null)} />
            <Stat label="Protocol fees" value={usd(t ? t.feesUsd : null, 2)} />
            <Stat label="Swaps" value={qty(t?.swapCount ?? null)} />
            <Stat label="Bridges" value={qty(bridges)} />
          </StatStrip>
          <p className={s.sub}>Native pool swaps, aggregator trades and bridges. Each swap transaction is counted once; fees show Kaleido protocol revenue.</p>
          {t?.partial ? (
            <p className={s.empty}>
              A volume source is temporarily unavailable — these totals are a
              lower bound until it recovers.
            </p>
          ) : null}
        </section>

        {externalChains.map((chainId) => {
          const external = externalMarkets.find((snapshot) => snapshot.chainId === chainId);
          const chainName = chainId === 5042 ? "Arc" : chainId === 56 ? "BNB Smart Chain" : "Robinhood";
          return <section className={s.section} key={chainId}>
          <h2 className={s.h2}>{chainName} external markets</h2>
          <StatStrip>
            <Stat label="Pools indexed" value={qty(external?.totalPools ?? null)} />
            <Stat label="Sampled TVL" value={usd(external?.sampledTvlUsd ?? null)} />
            <Stat label="Sampled 24h volume" value={usd(external?.sampledVolume24hUsd ?? null)} />
            <Stat label="Sampled 24h fees" value={usd(external?.sampledFees24hUsd ?? null, 2)} />
          </StatStrip>
          <p className={s.empty}>
            KyberSwap-ranked external liquidity; sampled figures are separate from Kaleido-owned pools.
            {external ? ` Tracking ${external.sampledPools} of ${external.totalPools} indexed pools. Fetched ${new Date(external.asOf).toLocaleTimeString()}.` : " External market data is temporarily unavailable."}
            {external?.stale ? " Showing the last available snapshot." : ""}
          </p>
        </section>;
        })}

        <section className={s.section}>
          <h2 className={s.h2}>Lending · open book</h2>
          <StatStrip>
            <Stat label="Open book" value={usd(lending.stats?.lendingTvlUsd ?? null)} />
            <Stat label="Open offers" value={qty(lending.stats?.openOffers ?? null)} />
            <Stat label="Open requests" value={qty(lending.stats?.openRequests ?? null)} />
            <Stat label="Loans outstanding" value={qty(lending.stats?.loansOutstanding ?? null)} />
          </StatStrip>
          {lending.error && <p role="status">Lending data unavailable.</p>}
          {!!lending.stats?.degraded?.length && <p role="status">Some lending sources are unavailable; totals may be incomplete.</p>}
        </section>

        <section className={s.section}>
          <h2 className={s.h2}>Users &amp; growth · all networks</h2>
          <StatStrip>
            <Stat label="Unique wallets" value={qty(g?.uniqueWallets ?? null)} />
            <Stat label="Waitlist" value={qty(g?.waitlistMembers ?? null)} />
            <Stat label="Referrals" value={qty(g?.referrals ?? null)} />
          </StatStrip>
        </section>

        <section className={s.section}>
          <h2 className={s.h2}>Luca (agent) · all networks</h2>
          <StatStrip>
            <Stat label="Cloud turns" value={qty(l?.turns ?? null)} />
            <Stat label="Local intent" value={qty(l?.localIntentTurns ?? null)} />
            <Stat label="Follow-ups" value={qty(l?.localFollowUps ?? null)} />
            <Stat
              label="Handled rate"
              value={pct(l ? l.handledRate * 100 : null, 1)}
            />
            <Stat label="Avg latency" value={l?.avgLatencyMs != null ? `${(l.avgLatencyMs / 1000).toFixed(1)}s` : "0"} />
          </StatStrip>
        </section>

        <section className={s.section}>
          <h2 className={s.h2}>Points · all networks</h2>
          <StatStrip>
            <Stat
              label="Points distributed"
              value={qty(p ? Math.round(p.totalPoints) : null)}
            />
          </StatStrip>
          {topSources.length > 0 ? (
            <div className={s.breakdown}>
              {topSources.map(([slug, pts]) => (
                <div key={slug} className={s.brow}>
                  <span className={s.blabel}>{slug.replace(/_/g, " ")}</span>
                  <span className={s.bvalue}>{qty(Math.round(pts))}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className={s.empty}>No points recorded yet.</p>
          )}
        </section>
        {series.length > 0 ? (
          <section className={s.section}>
            <h2 className={s.h2}>Trends · last 30 days</h2>
            <div className={s.charts}>
              <TimeChart label="Volume" hint="30d" summary={usd(sum((d) => d.volumeUsd))} points={series.map((d) => d.volumeUsd)} />
              <TimeChart label="Fees" hint="30d" summary={usd(sum((d) => d.feesUsd), 2)} points={series.map((d) => d.feesUsd)} />
              <TimeChart label="Swaps" hint="30d" summary={qty(sum((d) => d.swaps))} points={series.map((d) => d.swaps)} />
              <TimeChart label="New wallets" hint="30d" summary={qty(sum((d) => d.newWallets))} points={series.map((d) => d.newWallets)} />
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
