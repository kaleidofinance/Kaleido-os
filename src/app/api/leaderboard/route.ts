import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase/supabaseClient"

export const revalidate = 60 // revalidate every 60s

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100)

    // 1. Sum DEX/AI swap points from activity indexer
    const { data: activityData, error: activityError } = await supabase
      .from("kaleido_protocol_activity")
      .select("wallet, points_earned")

    if (activityError) {
      return NextResponse.json({ error: activityError.message }, { status: 500 })
    }

    // Aggregate activity points per wallet
    const activityMap: Record<string, number> = {}
    for (const row of activityData || []) {
      const w = row.wallet?.toLowerCase()
      if (w) activityMap[w] = (activityMap[w] || 0) + (row.points_earned || 0)
    }

    // 2. Count marketplace listings per wallet (sender)
    const { data: listingsData } = await supabase
      .from("kaleido_listings")
      .select("sender")

    const listingsMap: Record<string, number> = {}
    for (const row of listingsData || []) {
      const w = row.sender?.toLowerCase()
      if (w) listingsMap[w] = (listingsMap[w] || 0) + 1
    }

    // 3. Count borrow requests per wallet (author)
    const { data: requestsData } = await supabase
      .from("kaleido_requests")
      .select("author")

    const requestsMap: Record<string, number> = {}
    for (const row of requestsData || []) {
      const w = row.author?.toLowerCase()
      if (w) requestsMap[w] = (requestsMap[w] || 0) + 1
    }

    // 4. Merge all wallets
    const allWallets = new Set([
      ...Object.keys(activityMap),
      ...Object.keys(listingsMap),
      ...Object.keys(requestsMap),
    ])

    // 5. Calculate total points per wallet
    const leaderboard = Array.from(allWallets).map((wallet) => {
      const swapPts = activityMap[wallet] || 0
      const listingPts = Math.min(listingsMap[wallet] || 0, 5) * 100
      const requestPts = Math.min(requestsMap[wallet] || 0, 5) * 50
      const total = swapPts + listingPts + requestPts

      return {
        wallet,
        totalPoints: total,
        breakdown: {
          swaps: swapPts,
          listings: listingPts,
          requests: requestPts,
        },
      }
    })

    // 6. Sort by total points descending, take top N
    leaderboard.sort((a, b) => b.totalPoints - a.totalPoints)
    const top = leaderboard.slice(0, limit)

    return NextResponse.json({
      success: true,
      data: top,
      total: leaderboard.length,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
