import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/supabaseClient";
import { parseBookIdSearch, resolveBookSort } from "@/lib/supabase/bookQuery";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Cursor pagination parameters
    const cursor = searchParams.get("cursor"); // ID to start from
    const limit = parseInt(searchParams.get("limit") || "100");
    const loadAll = searchParams.get("loadAll") === "true";

    // Filter parameters
    const status = searchParams.get("status");
    const tokenAddress = searchParams.get("tokenAddress");
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const search = searchParams.get("search");
    const searchId = searchParams.get("searchId"); // Search by listing ID
    const sender = searchParams.get("sender"); // Filter by sender (owner filter)

    /* "listingId" is a bigint primary key, so this is an exact match or nothing.
     * See src/lib/supabase/bookQuery.ts — the old eq-OR-ilike pair made every id
     * search a 500, whatever was typed. */
    const idSearch = parseBookIdSearch(searchId);
    if (idSearch.kind === "impossible") {
      return NextResponse.json({
        success: true,
        data: [],
        nextCursor: null,
        hasMore: false,
        total: 0,
        message: `No listings found — ${idSearch.reason}`,
      });
    }
    /* Everything below gates on this rather than on raw `searchId`, which was
     * truthy for input the query never used — a whitespace-only value disabled
     * pagination while filtering on nothing. */
    const isIdSearch = idSearch.kind === "exact";

    /* `sortBy` drives both `.order()` and the cursor comparison, so it is
     * allowlisted to columns that compare numerically — see bookQuery.ts. */
    const { column: sortBy, ignored: ignoredSort } = resolveBookSort(
      "listings",
      searchParams.get("sortBy"),
    );
    if (ignoredSort) {
      console.warn(
        `⚠️ Ignoring sortBy="${ignoredSort}" — not sortable; using ${sortBy}`,
      );
    }

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
    });

    // Get total count for client reference
    let countQuery = supabase
      .from("kaleido_listings")
      .select("*", { count: "exact", head: true });

    // Apply the same filters for counting
    if (status) countQuery = countQuery.eq("status", status);
    if (tokenAddress) countQuery = countQuery.eq("tokenAddress", tokenAddress);
    if (search) countQuery = countQuery.ilike("sender", `%${search}%`);
    if (sender) countQuery = countQuery.ilike("sender", sender); // Owner filter for count
    if (idSearch.kind === "exact") {
      countQuery = countQuery.eq("listingId", idSearch.value);
    }

    /* No amount floor. The old `.gte("amount", 1e19)` compared a text column
     * lexicographically and dropped real orders while admitting dust; the $10
     * minimum is enforced on-chain at creation. bookQuery.ts has the details. */

    const { count: totalCount, error: countError } = await countQuery;

    if (countError) {
      console.error("❌ Error getting count:", countError);
      return NextResponse.json(
        {
          error: "Database connection failed",
          details: countError.message,
        },
        { status: 500 },
      );
    }

    if (totalCount === 0) {
      let message = "No listings found";
      if (idSearch.kind === "exact") {
        message = `No listing found with ID ${idSearch.value}`;
      } else if (sender) {
        message = `No listings found for owner ${sender}`;
      }

      return NextResponse.json({
        success: true,
        data: [],
        nextCursor: null,
        hasMore: false,
        total: 0,
        message,
      });
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
      `);

    // Apply filters
    if (status) query = query.eq("status", status);
    if (tokenAddress) query = query.eq("tokenAddress", tokenAddress);
    if (search) query = query.ilike("sender", `%${search}%`);
    if (sender) query = query.ilike("sender", sender); // Owner filter for main query

    // Apply ID search filter
    if (idSearch.kind === "exact") {
      query = query.eq("listingId", idSearch.value);
    }

    // No amount floor — see the count query above and bookQuery.ts.

    // Apply cursor-based pagination (but not when searching by ID or filtering by owner for better UX)
    if (cursor && !loadAll && !isIdSearch && !sender) {
      console.log(`🔄 Applying cursor: ${cursor}`);

      // For cursor pagination, we need to use the cursor as a starting point
      if (sortOrder === "desc") {
        query = query.lt(sortBy, cursor);
      } else {
        query = query.gt(sortBy, cursor);
      }
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === "asc" });

    // Apply limit (unless loading all, searching by ID, or filtering by owner)
    if (!loadAll && !isIdSearch && !sender) {
      query = query.limit(limit + 1); // +1 to check if there are more records
    } else if (isIdSearch || sender) {
      // Limit ID search and owner filter results to prevent overwhelming results
      query = query.limit(100);
    }

    console.log("⚡ Executing cursor-based query...");
    const { data: listings, error } = await query;

    if (error) {
      console.error("❌ Database error:", error);
      return NextResponse.json(
        {
          error: "Failed to fetch listings",
          details: error.message,
        },
        { status: 500 },
      );
    }

    let hasMore = false;
    let nextCursor = null;
    let actualData = listings || [];

    // Handle pagination (skip when searching by ID or filtering by owner)
    if (!loadAll && !isIdSearch && !sender && actualData.length > limit) {
      // Remove the extra record we fetched to check for more data
      actualData = actualData.slice(0, limit);
      hasMore = true;

      // Set the next cursor to the last item's ID
      const lastItem = actualData[actualData.length - 1];
      nextCursor = lastItem[sortBy as keyof typeof lastItem];
    }

    console.log(
      `✅ Query successful! Retrieved ${actualData.length} records, hasMore: ${hasMore}`,
    );

    return NextResponse.json({
      success: true,
      data: actualData,
      nextCursor: isIdSearch || sender ? null : nextCursor, // No cursor pagination when searching by ID or owner
      hasMore: isIdSearch || sender ? false : hasMore, // No "load more" when searching by ID or owner
      total: totalCount,
      count: actualData.length,
      debug: {
        totalRowsInTable: totalCount,
        appliedFilters: {
          status,
          tokenAddress,
          search,
          searchId: isIdSearch ? idSearch.value : null,
          sender, // Include owner filter in debug
        },
        cursor: {
          current: cursor,
          next: nextCursor,
          hasMore,
          limit,
          loadAll,
        },
        searchMode: isIdSearch
          ? "ID_SEARCH"
          : sender
            ? "OWNER_FILTER"
            : "NORMAL",
      },
    });
  } catch (error) {
    console.error("💥 API error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
