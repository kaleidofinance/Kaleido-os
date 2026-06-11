"use client"

import { useEffect, useState } from "react"
import { useActiveAccount } from "thirdweb/react"

interface LeaderboardEntry {
  wallet: string
  totalPoints: number
  breakdown: {
    swaps: number
    listings: number
    requests: number
  }
}

const MEDALS = ["🥇", "🥈", "🥉"]

function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function getRankStyle(rank: number) {
  if (rank === 1) return "border-yellow-400/40 bg-yellow-400/5"
  if (rank === 2) return "border-white/20 bg-white/5"
  if (rank === 3) return "border-orange-400/30 bg-orange-400/5"
  return "border-white/5 bg-black/20"
}

function getBarColor(rank: number) {
  if (rank === 1) return "bg-yellow-400"
  if (rank === 2) return "bg-white/70"
  if (rank === 3) return "bg-orange-400"
  return "bg-[#00ff99]"
}

export default function LeaderboardPage() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string>("")

  const activeAccount = useActiveAccount()
  const myAddress = activeAccount?.address?.toLowerCase()

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        setLoading(true)
        const res = await fetch("/api/leaderboard?limit=50")
        const json = await res.json()
        if (!json.success) throw new Error(json.error || "Failed to load")
        setLeaderboard(json.data)
        setLastUpdated(new Date(json.generatedAt).toLocaleTimeString())
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }

    fetchLeaderboard()
    const interval = setInterval(fetchLeaderboard, 60000) // refresh every minute
    return () => clearInterval(interval)
  }, [])

  const myRank = leaderboard.findIndex((e) => e.wallet === myAddress) + 1
  const myEntry = leaderboard.find((e) => e.wallet === myAddress)
  const maxPoints = leaderboard[0]?.totalPoints || 1

  return (
    <div className="min-h-screen py-8 px-2">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">🏆</span>
          <h1 className="text-2xl font-bold text-white">Point System Leaderboard</h1>
        </div>
        <p className="text-white/40 text-sm">
          Ranked by total points across swaps, liquidity, marketplace, staking & AI interactions.
          {lastUpdated && <span className="ml-2 text-white/20">Updated {lastUpdated}</span>}
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
              <p className="text-sm font-semibold text-white font-mono">{shortenAddress(myEntry.wallet)}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-[#00ff99]">{myEntry.totalPoints.toLocaleString()}</p>
            <p className="text-xs text-white/40">Total Points</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-white/5 overflow-hidden backdrop-blur-xl bg-black/20">
        {/* Table Header */}
        <div className="grid grid-cols-12 px-4 py-3 border-b border-white/5 text-xs text-white/30 uppercase tracking-wider">
          <div className="col-span-1">Rank</div>
          <div className="col-span-4">Wallet</div>
          <div className="col-span-4">Progress</div>
          <div className="col-span-3 text-right">Points</div>
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

        {!loading && !error && leaderboard.map((entry, i) => {
          const rank = i + 1
          const isMe = entry.wallet === myAddress
          const pct = Math.max((entry.totalPoints / maxPoints) * 100, 2)

          return (
            <div
              key={entry.wallet}
              className={`grid grid-cols-12 items-center px-4 py-3.5 border-b border-white/5 transition-all ${getRankStyle(rank)} ${isMe ? "ring-1 ring-inset ring-[#00ff99]/20" : ""}`}
            >
              {/* Rank */}
              <div className="col-span-1 font-bold text-sm">
                {rank <= 3 ? (
                  <span className="text-lg">{MEDALS[rank - 1]}</span>
                ) : (
                  <span className="text-white/40">#{rank}</span>
                )}
              </div>

              {/* Wallet */}
              <div className="col-span-4">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#00ff99]/20 to-[#00ff99]/5 border border-[#00ff99]/10 flex items-center justify-center text-xs text-[#00ff99] font-bold">
                    {entry.wallet.slice(2, 4).toUpperCase()}
                  </div>
                  <div>
                    <p className={`text-sm font-mono font-medium ${isMe ? "text-[#00ff99]" : "text-white/80"}`}>
                      {shortenAddress(entry.wallet)}
                      {isMe && <span className="ml-1.5 text-xs bg-[#00ff99]/10 text-[#00ff99] px-1.5 py-0.5 rounded-full">You</span>}
                    </p>
                    {/* Breakdown tooltip-style */}
                    <p className="text-xs text-white/25 mt-0.5">
                      Swaps {entry.breakdown.swaps} · Market {entry.breakdown.listings + entry.breakdown.requests}
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="col-span-4 pr-4">
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${getBarColor(rank)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {/* Points */}
              <div className="col-span-3 text-right">
                <p className={`text-sm font-bold tabular-nums ${rank === 1 ? "text-yellow-400" : rank <= 3 ? "text-white" : "text-white/70"}`}>
                  {entry.totalPoints.toLocaleString()}
                </p>
                <p className="text-xs text-white/25">pts</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Point System Legend */}
      <div className="mt-6 rounded-xl border border-white/5 bg-black/20 p-4 backdrop-blur-xl">
        <p className="text-xs text-white/30 uppercase tracking-wider mb-3">How Points Are Earned</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: "Swap Volume", value: "$1 = 1 pt", icon: "🔄" },
            { label: "Agent Swap (Luca)", value: "$1 = 1.2 pts", icon: "🤖" },
            { label: "LP Position", value: "250 pts / NFT", icon: "💧" },
            { label: "Marketplace Order", value: "50–100 pts", icon: "📋" },
            { label: "KLD Staking", value: "10 pts / KLD", icon: "🏛️" },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-white/5 bg-white/2 px-3 py-2.5">
              <p className="text-base mb-1">{item.icon}</p>
              <p className="text-xs text-white/60 font-medium">{item.label}</p>
              <p className="text-xs text-[#00ff99] mt-0.5">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
