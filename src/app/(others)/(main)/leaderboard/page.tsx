"use client";

import { useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";

interface LeaderboardEntry {
  wallet: string;
  totalPoints: number;
  breakdown: {
    swaps: number;
    listings: number;
    requests: number;
  };
}

const MEDALS = ["🥇", "🥈", "🥉"];

function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function getRankStyle(rank: number) {
  if (rank === 1) return "border-[#00ff99]/50 bg-[#00ff99]/10";
  if (rank === 2) return "border-[#00ff99]/30 bg-[#00ff99]/5";
  if (rank === 3) return "border-white/15 bg-white/5";
  return "border-white/5 bg-black/20";
}

function getBarColor(rank: number) {
  if (rank === 1) return "bg-[#00ff99]";
  if (rank === 2) return "bg-white/70";
  if (rank === 3) return "bg-white/40";
  return "bg-[#00ff99]";
}

export default function LeaderboardPage() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const activeAccount = useActiveAccount();
  const myAddress = activeAccount?.address?.toLowerCase();

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/leaderboard?limit=50");
        const json = await res.json();
        if (!json.success) throw new Error(json.error || "Failed to load");
        setLeaderboard(json.data);
        setLastUpdated(new Date(json.generatedAt).toLocaleTimeString());
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  const myRank = leaderboard.findIndex((e) => e.wallet === myAddress) + 1;
  const myEntry = leaderboard.find((e) => e.wallet === myAddress);
  const maxPoints = leaderboard[0]?.totalPoints || 1;

  return (
    <div className="min-h-screen py-8 px-2">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">🏆</span>
          <h1 className="text-2xl font-bold text-white">
            Point System Leaderboard
          </h1>
        </div>
        <p className="text-white/40 text-sm">
          Ranked by total points across swaps, liquidity, marketplace, staking &
          AI interactions.
          {lastUpdated && (
            <span className="ml-2 text-white/20">Updated {lastUpdated}</span>
          )}
        </p>
      </div>

      {/* My Rank Card (if connected and ranked) */}
      {myEntry && (
        <div className="mb-6 rounded-xl border border-[#00ff99]/30 bg-[#00ff99]/5 p-4 flex items-center justify-between backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-[#00ff99]/10 text-[#00ff99] font-bold text-sm border border-[#00ff99]/20">
              #{myRank}
            </div>
            <div>
              <p className="text-xs text-white/40 mb-0.5">Your Rank</p>
              <p className="text-sm font-semibold text-white font-mono">
                {shortenAddress(myEntry.wallet)}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-[#00ff99]">
              {myEntry.totalPoints.toLocaleString()}
            </p>
            <p className="text-xs text-white/40">Total Points</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-white/5 overflow-hidden backdrop-blur-xl bg-black/20">
        {/* Table Header */}
        <div className="hidden grid-cols-12 border-b border-white/5 px-4 py-3 text-xs uppercase tracking-wider text-white/30 sm:grid">
          <div className="col-span-1">Rank</div>
          <div className="min-w-0 sm:col-span-4">Wallet</div>
          <div className="min-w-0 sm:col-span-4">Progress</div>
          <div className="mt-3 flex items-end justify-between sm:col-span-3 sm:mt-0 sm:block sm:text-right">
            Points
          </div>
        </div>

        {loading && (
          <div className="py-20 flex flex-col items-center gap-3 text-white/30">
            <div className="w-6 h-6 border-2 border-[#00ff99]/30 border-t-[#00ff99] rounded-full animate-spin" />
            <p className="text-sm">Loading leaderboard...</p>
          </div>
        )}

        {error && !loading && (
          <div className="py-20 text-center text-red-400/70 text-sm">
            ⚠️ {error}
          </div>
        )}

        {!loading && !error && leaderboard.length === 0 && (
          <div className="py-20 text-center text-white/30 text-sm">
            No activity recorded yet. Be the first to earn points!
          </div>
        )}

        {!loading &&
          !error &&
          leaderboard.map((entry, i) => {
            const rank = i + 1;
            const isMe = entry.wallet === myAddress;
            const pct = Math.max((entry.totalPoints / maxPoints) * 100, 2);

            return (
              <div
                key={entry.wallet}
                className={`block border-b border-white/5 px-3 py-4 transition-all sm:grid sm:grid-cols-12 sm:items-center sm:px-4 sm:py-3.5 ${getRankStyle(rank)} ${isMe ? "ring-1 ring-inset ring-[#00ff99]/20" : ""}`}
              >
                {/* Rank */}
                <div className="mb-3 text-sm font-bold sm:col-span-1 sm:mb-0">
                  {rank <= 3 ? (
                    <span className="text-lg">{MEDALS[rank - 1]}</span>
                  ) : (
                    <span className="text-white/40">#{rank}</span>
                  )}
                </div>

                {/* Wallet */}
                <div className="min-w-0 sm:col-span-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#00ff99]/10 bg-gradient-to-br from-[#00ff99]/20 to-[#00ff99]/5 text-xs font-bold text-[#00ff99]">
                      {entry.wallet.slice(2, 4).toUpperCase()}
                    </div>
                    <div>
                      <p
                        className={`truncate font-mono text-sm font-medium ${isMe ? "text-[#00ff99]" : "text-white/80"}`}
                      >
                        {shortenAddress(entry.wallet)}
                        {isMe && (
                          <span className="ml-1.5 text-xs bg-[#00ff99]/10 text-[#00ff99] px-1.5 py-0.5 rounded-full">
                            You
                          </span>
                        )}
                      </p>
                      {/* Breakdown tooltip-style */}
                      <p className="text-xs text-white/25 mt-0.5">
                        Swaps {entry.breakdown.swaps} · Market{" "}
                        {entry.breakdown.listings + entry.breakdown.requests}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3 sm:col-span-4 sm:mt-0 sm:pr-4">
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${getBarColor(rank)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* Points */}
                <div className="mt-3 flex items-end justify-between sm:col-span-3 sm:mt-0 sm:block sm:text-right">
                  <p
                    className={`text-right text-xs font-bold tabular-nums sm:text-sm ${rank === 1 ? "text-[#00ff99]" : rank <= 3 ? "text-white" : "text-white/70"}`}
                  >
                    {entry.totalPoints.toLocaleString()}
                  </p>
                  <p className="text-xs text-white/25">pts</p>
                </div>
              </div>
            );
          })}
      </div>

      {/* Point System Legend */}
      <div className="mt-6 rounded-xl border border-white/5 bg-black/20 p-4 backdrop-blur-xl">
        <p className="text-xs text-white/30 uppercase tracking-wider mb-3">
          How Points Are Earned
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: "Swap Volume", value: "$1 = 1 pt", icon: "🔄" },
            { label: "Agent Swap (Luca)", value: "$1 = 1.2 pts", icon: "🤖" },
            { label: "LP Position", value: "250 pts / NFT", icon: "💧" },
            { label: "Marketplace Order", value: "50–100 pts", icon: "📋" },
            { label: "KLD Staking", value: "10 pts / KLD", icon: "🏛️" },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-white/5 bg-white/2 px-3 py-2.5"
            >
              <p className="text-base mb-1">{item.icon}</p>
              <p className="text-xs text-white/60 font-medium">{item.label}</p>
              <p className="text-xs text-[#00ff99] mt-0.5">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
