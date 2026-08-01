"use client";

import { useMemo, useState } from "react";
import Nav from "@/components/v2/Nav";
import { useMarketStats } from "@/hooks/market/useMarketStats";
import { usePoolData } from "@/hooks/dex/usePoolData";
import { useRecentActivity } from "@/hooks/v2/useRecentActivity";
import { getTxUrl } from "@/constants/utils/getTxUrl";
import s from "./explore.module.css";

const usd = (n: number, dp = 0) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

const pct = (n: number) => `${n.toFixed(2)}%`;

const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const short = (v: string) => (v?.startsWith("0x") ? `${v.slice(0, 6)}…${v.slice(-4)}` : v);

const ACTIVITY_LABEL: Record<string, string> = {
  swap: "Swap",
  agent_swap: "Agent swap",
  add_liquidity: "Add liquidity",
  remove_liquidity: "Remove liquidity",
};

const TABS = ["Pools", "Transactions"] as const;

export default function ExplorePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Pools");
  const { stats, loading: statsLoading } = useMarketStats();
  const { pools, loading: poolsLoading } = usePoolData();
  const { rows: activity, loading: activityLoading } = useRecentActivity(25);

  const sortedPools = useMemo(
    () => [...pools].sort((a, b) => b.liquidity - a.liquidity),
    [pools],
  );

  return (
    <>
      <Nav />
      <main className={s.wrap}>
        <div className={s.head}>
          <h1 className={s.h1}>Explore</h1>
        </div>

        <div className={s.strip}>
          <div className={s.stat}>
            <span className={s.sLabel}>TVL</span>
            <span className={`${s.sVal} tabular`}>
              {statsLoading ? "—" : usd(stats.totalTVL)}
            </span>
          </div>
          <div className={s.stat}>
            <span className={s.sLabel}>Volume serviced</span>
            <span className={`${s.sVal} tabular`}>
              {statsLoading ? "—" : usd(stats.totalVolume)}
            </span>
          </div>
          <div className={s.stat}>
            <span className={s.sLabel}>Revenue</span>
            <span className={`${s.sVal} tabular`}>
              {statsLoading ? "—" : usd(stats.revenue, 2)}
            </span>
          </div>
          <div className={s.stat}>
            <span className={s.sLabel}>Requests serviced</span>
            <span className={`${s.sVal} tabular`}>
              {statsLoading ? "—" : stats.serviceRequests.toLocaleString()}
            </span>
          </div>
        </div>

        <div className={s.tabs}>
          {TABS.map((t) => (
            <button
              key={t}
              className={`${s.tab} ${tab === t ? s.tabOn : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "Pools" ? (
          <div className={`${s.table} ${s.pools}`}>
            <div className={s.thead}>
              <span>Pool</span>
              <span className={s.right}>Price</span>
              <span className={s.right}>24h volume</span>
              <span className={s.right}>TVL</span>
              <span className={s.right}>APR</span>
            </div>
            {poolsLoading && sortedPools.length === 0 ? (
              [0, 1, 2].map((i) => (
                <div key={i} className={s.rowSkeleton}>
                  <span className={s.skCircle} />
                  <span className={s.skLine} />
                </div>
              ))
            ) : sortedPools.length === 0 ? (
              <div className={s.empty}>No pools indexed yet.</div>
            ) : (
              sortedPools.map((p) => (
                <div key={p.address} className={s.row}>
                  <div className={s.pairCell}>
                    <div className={s.pair}>
                      <span className={s.tki}>{p.token0.symbol.slice(0, 3)}</span>
                      <span className={s.tki}>{p.token1.symbol.slice(0, 3)}</span>
                    </div>
                    <div>
                      <div className={s.pairName}>
                        {p.token0.symbol} / {p.token1.symbol}
                      </div>
                      <div className={s.pairFee}>{p.stable ? "Stable" : "Volatile"} · V2</div>
                    </div>
                  </div>
                  <span className={`${s.right} tabular`}>
                    {p.price > 0 ? p.price.toFixed(p.price < 1 ? 6 : 4) : "—"}
                  </span>
                  <span className={`${s.right} tabular`}>{usd(p.volume24h)}</span>
                  <span className={`${s.right} tabular`}>{usd(p.liquidity)}</span>
                  <span className={`${s.right} tabular`}>{pct(p.apr)}</span>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className={`${s.table} ${s.tx}`}>
            <div className={s.thead}>
              <span>Type</span>
              <span>Tokens</span>
              <span className={s.right}>Amount</span>
              <span className={s.right}>Points</span>
              <span className={s.right}>Time</span>
            </div>
            {activityLoading && activity.length === 0 ? (
              [0, 1, 2].map((i) => (
                <div key={i} className={s.rowSkeleton}>
                  <span className={s.skLine} />
                </div>
              ))
            ) : activity.length === 0 ? (
              <div className={s.empty}>No activity indexed yet.</div>
            ) : (
              activity.map((a, i) => (
                <div key={`${a.txHash}-${i}`} className={s.row}>
                  <span>
                    <span className={`${s.badge} ${a.isAgentInitiated ? s.agent : ""}`}>
                      {a.isAgentInitiated ? "Luca · " : ""}
                      {ACTIVITY_LABEL[a.activityType] ?? a.activityType}
                    </span>
                  </span>
                  <span>
                    {short(a.tokenIn)} → {short(a.tokenOut)}
                  </span>
                  <span className={`${s.right} tabular`}>{usd(a.amountInUsd, 2)}</span>
                  <span className={`${s.right} tabular`}>{a.pointsEarned.toLocaleString()}</span>
                  <span className={s.right}>
                    {a.txHash ? (
                      <a
                        className={s.txLink}
                        href={getTxUrl(a.txHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {timeAgo(a.createdAt)}
                      </a>
                    ) : (
                      timeAgo(a.createdAt)
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </>
  );
}
