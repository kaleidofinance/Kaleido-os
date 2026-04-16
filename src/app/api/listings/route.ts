import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase/supabaseClient"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Cursor pagination parameters
    const cursor = searchParams.get("cursor") // ID to start from
    const limit = parseInt(searchParams.get("limit") || "100")
    const loadAll = searchParams.get("loadAll") === "true"

    // Filter parameters
    const status = searchParams.get("status")
    const tokenAddress = searchParams.get("tokenAddress")
    const sortBy = searchParams.get("sortBy") || "listingId"
    const sortOrder = searchParams.get("sortOrder") || "desc"
    const search = searchParams.get("search")
    const searchId = searchParams.get("searchId") // Search by listing ID
    const sender = searchParams.get("sender") // Filter by sender (owner filter)

    console.log("🔧 Cursor API Parameters:", {
      cursor,
      limit,
      loadAll,
      status,
      tokenAddress,
      sortBy,
      sortOrder,
      search,
      searchId,
      sender, // Log owner filter
    })

    // Get total count for client reference
    let countQuery = supabase.from("kaleido_listings").select("*", { count: "exact", head: true })

    // Apply the same filters for counting
    if (status) countQuery = countQuery.eq("status", status)
    if (tokenAddress) countQuery = countQuery.eq("tokenAddress", tokenAddress)
    if (search) countQuery = countQuery.ilike("sender", `%${search}%`)
    if (sender) countQuery = countQuery.ilike("sender", sender) // Owner filter for count
    if (searchId) {
      // For ID search, use both exact match and partial match
      countQuery = countQuery.or(`listingId.eq.${searchId},listingId.ilike.%${searchId}%`)
    }

    // Filter out listings less than $10 (assuming 18 decimals)
    countQuery = countQuery.gte("amount", 10000000000000000000)

    const { count: totalCount, error: countError } = await countQuery

    if (countError) {
      console.error("❌ Error getting count:", countError)
      return NextResponse.json(
        {
          error: "Database connection failed",
          details: countError.message,
        },
        { status: 500 },
      )
    }

    if (totalCount === 0) {
      let message = "No listings found"
      if (searchId) {
        message = `No listings found with ID containing "${searchId}"`
      } else if (sender) {
        message = `No listings found for owner ${sender}`
      }

      return NextResponse.json({
        success: true,
        data: [],
        nextCursor: null,
        hasMore: false,
        total: 0,
        message,
      })
    }

    // Build the main query
    let query = supabase.from("kaleido_listings").select(`
        listingId, 
        sender, 
        tokenAddress, 
        amount, 
        minAmount, 
        maxAmount, 
        returnDate, 
        interest, 
        status, 
        created_at
      `)

    // Apply filters
    if (status) query = query.eq("status", status)
    if (tokenAddress) query = query.eq("tokenAddress", tokenAddress)
    if (search) query = query.ilike("sender", `%${search}%`)
    if (sender) query = query.ilike("sender", sender) // Owner filter for main query

    // Apply ID search filter
    if (searchId) {
      // Support both exact match and partial match for ID
      const trimmedSearchId = searchId.trim()

      // If it looks like a number, try exact match first, then partial
      if (/^\d+$/.test(trimmedSearchId)) {
        query = query.or(`listingId.eq.${trimmedSearchId},listingId.ilike.%${trimmedSearchId}%`)
      } else {
        // For non-numeric searches, just do partial match
        query = query.ilike("listingId", `%${trimmedSearchId}%`)
      }
    }

    // Filter out listings less than $10
    query = query.gte("amount", 10000000000000000000)

    // Apply cursor-based pagination (but not when searching by ID or filtering by owner for better UX)
    if (cursor && !loadAll && !searchId && !sender) {
      console.log(`🔄 Applying cursor: ${cursor}`)

      // For cursor pagination, we need to use the cursor as a starting point
      if (sortOrder === "desc") {
        query = query.lt(sortBy, cursor)
      } else {
        query = query.gt(sortBy, cursor)
      }
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === "asc" })

    // Apply limit (unless loading all, searching by ID, or filtering by owner)
    if (!loadAll && !searchId && !sender) {
      query = query.limit(limit + 1) // +1 to check if there are more records
    } else if (searchId || sender) {
      // Limit ID search and owner filter results to prevent overwhelming results
      query = query.limit(100)
    }

    console.log("⚡ Executing cursor-based query...")
    const { data: listings, error } = await query

    if (error) {
      console.error("❌ Database error:", error)
      return NextResponse.json(
        {
          error: "Failed to fetch listings",
          details: error.message,
        },
        { status: 500 },
      )
    }

    let hasMore = false
    let nextCursor = null
    let actualData = listings || []

    // Handle pagination (skip when searching by ID or filtering by owner)
    if (!loadAll && !searchId && !sender && actualData.length > limit) {
      // Remove the extra record we fetched to check for more data
      actualData = actualData.slice(0, limit)
      hasMore = true

      // Set the next cursor to the last item's ID
      const lastItem = actualData[actualData.length - 1]
      nextCursor = lastItem[sortBy as keyof typeof lastItem]
    }

    console.log(`✅ Query successful! Retrieved ${actualData.length} records, hasMore: ${hasMore}`)

    return NextResponse.json({
      success: true,
      data: actualData,
      nextCursor: searchId || sender ? null : nextCursor, // No cursor pagination when searching by ID or owner
      hasMore: searchId || sender ? false : hasMore, // No "load more" when searching by ID or owner
      total: totalCount,
      count: actualData.length,
      debug: {
        totalRowsInTable: totalCount,
        appliedFilters: {
          status,
          tokenAddress,
          search,
          searchId,
          sender, // Include owner filter in debug
        },
        cursor: {
          current: cursor,
          next: nextCursor,
          hasMore,
          limit,
          loadAll,
        },
        searchMode: searchId ? "ID_SEARCH" : sender ? "OWNER_FILTER" : "NORMAL",
      },
    })
  } catch (error) {
    console.error("💥 API error:", error)
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
