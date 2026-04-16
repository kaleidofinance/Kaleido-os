import React, { useEffect, useState, useCallback, useMemo } from "react"
import { useActiveAccount } from "thirdweb/react"
import { Request } from "@/constants/types"

interface FetchParams {
  status?: string // e.g., "OPEN" or "OPEN,SERVICED"
  tokenAddress?: string
  author?: string
  lender?: string
  sortBy?: string
  sortOrder?: "asc" | "desc"
  search?: string
}

const useFetchAllRequests = () => {
  const [allRequests, setAllRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const activeAccount = useActiveAccount()
  const address = activeAccount?.address

  const fetchAllBatches = useCallback(async (params: FetchParams = {}) => {
    const batchSize = 1000
    let page = 1
    let allResults: Request[] = []
    let done = false

    // console.log("🔍 Starting fetch with params:", params)

    while (!done) {
      const queryParams = new URLSearchParams({
        limit: batchSize.toString(),
        page: page.toString(),
        ...params,
      })

      const url = `/api/requests?${queryParams.toString()}`
      //   console.log(`📡 Fetching page ${page}:`, url)

      try {
        const response = await fetch(url)
        // console.log("📊 Response status:", response.status)

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const data = await response.json()
        // console.log(`📄 Page ${page} response:`, data)

        if (data.success && data.data && Array.isArray(data.data)) {
          //   console.log(`✅ Page ${page} returned ${data.data.length} items`)

          if (data.data.length > 0) {
            allResults = [...allResults, ...data.data]
            // console.log(`📈 Total items so far: ${allResults.length}`)

            if (data.data.length < batchSize) {
              //   console.log("🏁 Last page reached (less than batch size)")
              done = true
            } else {
              page += 1
            }
          } else {
            // console.log("📭 Empty page received")
            done = true
          }
        } else {
          //   console.log("❌ Invalid response structure or not successful")
          done = true
          if (!data.success) {
            throw new Error(data.error || "Failed to fetch requests")
          }
        }
      } catch (fetchError) {
        console.error(`🚨 Fetch error on page ${page}:`, fetchError)
        throw fetchError
      }
    }

    // console.log(`🎯 Final result: ${allResults.length} total items`)
    return allResults
  }, [])

  useEffect(() => {
    ;(async () => {
      //   console.log("🚀 useEffect triggered - starting data fetch")
      setLoading(true)
      setError(null)
      try {
        // Fetch both OPEN and SERVICED requests
        const allData = await fetchAllBatches({ status: "OPEN,SERVICED" })
        setAllRequests(allData)
        // console.log("✅ Successfully fetched all requests:", allData.length, "items")

        // Log first few items for inspection
        if (allData.length > 0) {
          //   console.log("📋 Sample data (first 3 items):", allData.slice(0, 3))
        } else {
          //   console.log("⚠️ No data returned - this might be the issue!")
        }
      } catch (err) {
        console.error("💥 Batch fetching failed:", err)
        setError(err instanceof Error ? err.message : "Unknown error")
        setAllRequests([])
      } finally {
        setLoading(false)
        // console.log("🏁 Loading complete")
      }
    })()
  }, [fetchAllBatches])

  // Requests from current user as author
  const myRequests = useMemo(() => {
    if (!address || !allRequests.length) {
      //   console.log("👤 No address or requests for myRequests filter")
      return []
    }
    const filtered = allRequests.filter((request) => request.author?.toLowerCase() === address.toLowerCase())
    // console.log(`👤 myRequests: ${filtered.length} out of ${allRequests.length}`)
    return filtered
  }, [allRequests, address])

  // Active requests: OPEN and SERVICED
  const activeRequests = useMemo(() => {
    const filtered = allRequests.filter((request) => request.status === "OPEN" || request.status === "SERVICED")
    // console.log(`🔄 activeRequests: ${filtered.length} out of ${allRequests.length}`)
    return filtered
  }, [allRequests])

  const refreshRequests = useCallback(
    async (params?: FetchParams) => {
      //   console.log("🔄 Manual refresh triggered with params:", params)
      setLoading(true)
      setError(null)
      try {
        const allData = await fetchAllBatches(params)
        setAllRequests(allData)
        // console.log("🔄 Refresh completed:", allData.length, "items")
      } catch (err) {
        // console.error("💥 Refresh failed:", err)
        setError(err instanceof Error ? err.message : "Unknown error")
      } finally {
        setLoading(false)
      }
    },
    [fetchAllBatches],
  )

  return {
    requests: allRequests,
    activeRequests,
    myRequests,
    loading,
    error,
    refreshRequests,
  }
}

export default useFetchAllRequests
