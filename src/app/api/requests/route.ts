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
    const statusParam = searchParams.get("status") || ""
    const tokenAddress = searchParams.get("tokenAddress")
    const sortBy = searchParams.get("sortBy") || "requestId"
    const sortOrder = searchParams.get("sortOrder") || "desc"
    const search = searchParams.get("search")
    const author = searchParams.get("author") // Filter by author (owner filter)
    const lender = searchParams.get("lender")
    const searchId = searchParams.get("searchId") // Search by request ID

    console.log("🔧 Cursor API Parameters:", {
      cursor,
      limit,
      loadAll,
      statusParam,
      tokenAddress,
      sortBy,
      sortOrder,
      search,
      author, // Log owner filter
      lender,
      searchId,
    })

    // Only allow filtering between OPEN and SERVICED by default, but allow all for user history
    const allowedStatuses = ["OPEN", "SERVICED", "CLOSED"]
    const defaultStatuses = ["OPEN", "SERVICED"]
    let statuses = defaultStatuses

    if (statusParam) {
      const requestedStatuses = statusParam.includes(",")
        ? statusParam.split(",").map((s) => s.trim().toUpperCase())
        : [statusParam.toUpperCase()]

      statuses = requestedStatuses.filter((status) => allowedStatuses.includes(status))
      if (statuses.length === 0) {
        statuses = defaultStatuses
      }
    } else if (author || lender) {
      // If we're looking at a specific user's orders, show everything including closed
      statuses = allowedStatuses
    }

    // Get total count for client reference
    let countQuery = supabase
      .from("kaleido_requests")
      .select("*", { count: "exact", head: true })
      .in("status", statuses)

    // Apply the same filters for counting
    if (tokenAddress) countQuery = countQuery.eq("tokenAddress", tokenAddress)
    if (author) countQuery = countQuery.ilike("author", author) // Owner filter for count
    if (lender) countQuery = countQuery.ilike("lender", lender)
    if (search) countQuery = countQuery.or(`author.ilike.%${search}%,lender.ilike.%${search}%`)
    if (searchId) {
      // For ID search, use both exact match and partial match
      countQuery = countQuery.or(`requestId.eq.${searchId},requestId.ilike.%${searchId}%`)
    }

    // Filter out requests less than $10 (assuming 18 decimals)
    // 10 * 10^18 = 10000000000000000000
    // We filter out any amount that is smaller than this
    countQuery = countQuery.gte("amount", 10000000000000000000)

    const { count: totalCount, error: countError } = await countQuery

    if (countError) {
      return NextResponse.json(
        {
          error: "Database connection failed",
          details: countError.message,
        },
        { status: 500 },
      )
    }

    if (totalCount === 0) {
      let message = "No requests found in database"
      if (searchId) {
        message = `No requests found with ID containing "${searchId}"`
      } else if (author) {
        message = `No requests found for author ${author}`
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
    let query = supabase.from("kaleido_requests").select(`
        requestId, 
        listingId, 
        author, 
        amount, 
        interest, 
        totalRepayment, 
        returnDate, 
        lender, 
        tokenAddress, 
        collateralTokens, 
        status,
        created_at
      `)

    // Apply status filter
    if (statuses.length === 1) {
      query = query.eq("status", statuses[0])
    } else {
      query = query.in("status", statuses)
    }

    // Apply other filters
    if (tokenAddress) {
      query = query.eq("tokenAddress", tokenAddress)
    }

    if (author) {
      query = query.ilike("author", author) // Owner filter for main query
    }

    if (lender) {
      query = query.ilike("lender", lender)
    }

    if (search) {
      query = query.or(`author.ilike.%${search}%,lender.ilike.%${search}%`)
    }

    // Apply ID search filter
    if (searchId) {
      // Support both exact match and partial match for ID
      const trimmedSearchId = searchId.trim()

      // If it looks like a number, try exact match first, then partial
      if (/^\d+$/.test(trimmedSearchId)) {
        query = query.or(`requestId.eq.${trimmedSearchId},requestId.ilike.%${trimmedSearchId}%`)
      } else {
        // For non-numeric searches, just do partial match
        query = query.ilike("requestId", `%${trimmedSearchId}%`)
      }
    }

    // Filter out requests less than $10
    query = query.gte("amount", 10000000000000000000)

    // Apply cursor-based pagination (but not when searching by ID or filtering by owner for better UX)
    if (cursor && !loadAll && !searchId && !author) {
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
    if (!loadAll && !searchId && !author) {
      query = query.limit(limit + 1) // +1 to check if there are more records
    } else if (searchId || author) {
      // Limit ID search and owner filter results to prevent overwhelming results
      query = query.limit(100)
    }

    console.log("⚡ Executing cursor-based query...")
    const { data: requests, error } = await query

    if (error) {
      console.error("❌ Database error:", error)
      return NextResponse.json(
        {
          error: "Failed to fetch requests",
          details: error.message,
        },
        { status: 500 },
      )
    }

    let hasMore = false
    let nextCursor = null
    let actualData = requests || []

    // Handle pagination (skip when searching by ID or filtering by owner)
    if (!loadAll && !searchId && !author && actualData.length > limit) {
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
      nextCursor: searchId || author ? null : nextCursor, // No cursor pagination when searching by ID or owner
      hasMore: searchId || author ? false : hasMore, // No "load more" when searching by ID or owner
      total: totalCount,
      count: actualData.length,
      debug: {
        totalRowsInTable: totalCount,
        appliedFilters: {
          statuses,
          tokenAddress,
          author, // Include owner filter in debug
          lender,
          search,
          searchId,
        },
        cursor: {
          current: cursor,
          next: nextCursor,
          hasMore,
          limit,
          loadAll,
        },
        searchMode: searchId ? "ID_SEARCH" : author ? "OWNER_FILTER" : "NORMAL",
        note: "Results limited to OPEN and SERVICED orders only",
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
