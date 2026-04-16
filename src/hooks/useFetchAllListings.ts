import React, { useEffect, useState, useCallback, useMemo } from "react"
import { useActiveAccount } from "thirdweb/react"
import { LoanListing } from "@/constants/types"

interface FetchParams {
  status?: string
  tokenAddress?: string
  sortBy?: string
  sortOrder?: "asc" | "desc"
  search?: string
}

const useFetchAllListings = () => {
  const [allListings, setAllListings] = useState<LoanListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const activeAccount = useActiveAccount()
  const address = activeAccount?.address

  // Batch Fetch Function
  const fetchAllBatches = useCallback(async (params: FetchParams = {}) => {
    const batchSize = 1000
    let page = 1
    let allResults: LoanListing[] = []
    let done = false

    while (!done) {
      const queryParams = new URLSearchParams({
        limit: batchSize.toString(),
        page: page.toString(),
        ...params,
      })

      const response = await fetch(`/api/listings?${queryParams}`)
      const data = await response.json()

      if (data.success && data.data.length > 0) {
        allResults = [...allResults, ...data.data]
        if (data.data.length < batchSize) {
          done = true // No more data
        } else {
          page += 1
        }
      } else {
        done = true
        if (!data.success) {
          throw new Error(data.error || "Failed to fetch listings")
        }
      }
    }

    return allResults
  }, [])

  // Initial fetch
  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const allData = await fetchAllBatches({ status: "OPEN" })
        setAllListings(allData)
        // console.log("Fetched all listings:", allData)
      } catch (error) {
        // console.error("Batch fetching failed:", error)
        setError(error instanceof Error ? error.message : "Unknown error")
        setAllListings([])
      } finally {
        setLoading(false)
      }
    })()
  }, [fetchAllBatches])

  // Memoized user's listings
  const myListings = useMemo(() => {
    if (!address || !allListings.length) return []
    return allListings.filter((listing) => listing.sender?.toLowerCase() === address.toLowerCase())
  }, [allListings, address])

  // Memoized open listings (for borrowing)
  const openListings = useMemo(() => {
    return allListings.filter((listing) => listing.status === "OPEN")
  }, [allListings])

  // Refresh function
  const refreshListings = useCallback(
    async (params?: FetchParams) => {
      setLoading(true)
      setError(null)
      try {
        const allData = await fetchAllBatches(params)
        setAllListings(allData)
      } catch (error) {
        // console.error("Batch fetching failed:", error)
        setError(error instanceof Error ? error.message : "Unknown error")
      } finally {
        setLoading(false)
      }
    },
    [fetchAllBatches],
  )

  return {
    listings: allListings,
    openListings,
    myListings,
    loading,
    error,
    refreshListings,
    myLendOrder: {
      loadings: loading,
      data: myListings,
    },
  }
}

export default useFetchAllListings
