import React, { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useActiveAccount } from "thirdweb/react"
import { Request, LoanListing } from "@/constants/types"

interface FetchParams {
  status?: string
  tokenAddress?: string
  author?: string
  lender?: string
  sender?: string // Added sender parameter for listings
  sortBy?: string
  sortOrder?: "asc" | "desc"
  search?: string
  searchId?: string
}

interface CursorPaginationState<T> {
  data: T[]
  nextCursor: string | null
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  total: number
  error: string | null
}

// Request tracking with WeakMap for better cleanup
const activeRequestControllers = new Map<string, AbortController>()

// Generic cursor-based fetch function with improved request management
const fetchWithCursor = async <T>(
  endpoint: string,
  params: FetchParams = {},
  cursor: string | null = null,
  limit: number = 100,
  loadAll: boolean = false,
): Promise<{
  data: T[]
  nextCursor: string | null
  hasMore: boolean
  total: number
}> => {
  const queryParams = new URLSearchParams({
    limit: limit.toString(),
    loadAll: loadAll.toString(),
    ...Object.fromEntries(Object.entries(params).filter(([_, value]) => value !== undefined && value !== "")),
  })

  if (cursor) {
    queryParams.set("cursor", cursor)
  }

  const url = `${endpoint}?${queryParams.toString()}`

  // Cancel any existing request for this URL
  const existingController = activeRequestControllers.get(url)
  if (existingController && !existingController.signal.aborted) {
    existingController.abort()
  }

  // Create new controller for this request
  const controller = new AbortController()
  activeRequestControllers.set(url, controller)

  // Set up timeout
  const timeoutId = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
  }, 30000) // 30 second timeout

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || "Failed to fetch data")
    }

    return {
      data: data.data || [],
      nextCursor: data.nextCursor || null,
      hasMore: data.hasMore || false,
      total: data.total || 0,
    }
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error("Request cancelled or timeout")
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    activeRequestControllers.delete(url)
  }
}

// Enhanced interface for cursor hooks with search ID support
interface CursorHookParams extends FetchParams {
  searchId?: string
}

// Create a unique key for request identification
const createRequestKey = (params: FetchParams | null, endpoint: string): string => {
  if (!params) return `${endpoint}-empty`
  return `${endpoint}-${JSON.stringify(params)}`
}

// Requests Hook with Cursor Pagination and Search ID
export const useFetchRequestsWithCursor = (params?: CursorHookParams) => {
  const activeAccount = useActiveAccount()
  const address = activeAccount?.address
  const currentRequestRef = useRef<string | null>(null)

  const [state, setState] = useState<CursorPaginationState<Request>>({
    data: [],
    nextCursor: null,
    hasMore: true,
    isLoading: false,
    isLoadingMore: false,
    total: 0,
    error: null,
  })

  // Memoize fetch params to prevent unnecessary re-renders
  const fetchParams = useMemo(() => {
    if (!params) return null

    const cleanParams: FetchParams = {}
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") {
        cleanParams[key as keyof FetchParams] = value
      }
    })
    return cleanParams
  }, [params])

  // Create stable request key
  const requestKey = useMemo(() => createRequestKey(fetchParams, "/api/requests"), [fetchParams])

  // Fetch data function
  const fetchData = useCallback(
    async (isLoadMore = false, loadMoreAmount = 100) => {
      if (!fetchParams) return

      const thisRequestKey = `${requestKey}-${Date.now()}-${Math.random()}`
      currentRequestRef.current = thisRequestKey

      // Set loading state
      setState((prev) => ({
        ...prev,
        isLoading: !isLoadMore,
        isLoadingMore: isLoadMore,
        error: null,
      }))

      try {
        const searchLimit = fetchParams.searchId ? 100 : loadMoreAmount
        const cursor = isLoadMore ? state.nextCursor : null

        const result = await fetchWithCursor<Request>(
          "/api/requests",
          fetchParams,
          cursor,
          searchLimit,
          loadMoreAmount === -1,
        )

        // Check if this request is still current
        if (currentRequestRef.current !== thisRequestKey) {
          return // Ignore outdated requests
        }

        setState((prev) => ({
          ...prev,
          data: isLoadMore ? [...prev.data, ...result.data] : result.data,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          isLoading: false,
          isLoadingMore: false,
          total: result.total,
          error: null,
        }))
      } catch (error) {
        // Only update state if this is still the current request
        if (currentRequestRef.current === thisRequestKey) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isLoadingMore: false,
            error: error instanceof Error ? error.message : "Failed to load requests",
          }))
        }
      }
    },
    [fetchParams, requestKey, state.nextCursor],
  )

  // Load more data
  const loadMore = useCallback(
    async (amount: number) => {
      if (!fetchParams || fetchParams.searchId || !state.hasMore || state.isLoadingMore) {
        return
      }
      await fetchData(true, amount === -1 ? 0 : amount)
    },
    [fetchParams, state.hasMore, state.isLoadingMore, fetchData],
  )

  // Refresh all data
  const refresh = useCallback(() => {
    if (!fetchParams) return

    setState((prev) => ({
      ...prev,
      data: [],
      nextCursor: null,
      hasMore: true,
      total: 0,
      error: null,
    }))

    fetchData(false, 100)
  }, [fetchParams, fetchData])

  // Initialize and re-fetch when params change
  useEffect(() => {
    if (fetchParams) {
      fetchData(false, 100)
    } else {
      // Reset state when no params
      setState({
        data: [],
        nextCursor: null,
        hasMore: true,
        isLoading: false,
        isLoadingMore: false,
        total: 0,
        error: null,
      })
    }
  }, [fetchParams, requestKey]) // Include requestKey to trigger re-fetch when it changes

  // Derived data
  const myRequests = useMemo(() => {
    if (!address || !state.data.length) return []
    return state.data.filter((request) => request.author?.toLowerCase() === address.toLowerCase())
  }, [state.data, address])

  const activeRequests = useMemo(() => {
    return state.data.filter((request) => request.status === "OPEN" || request.status === "SERVICED")
  }, [state.data])

  return {
    // Data
    requests: state.data,
    activeRequests,
    myRequests,
    // Loading states
    loading: state.isLoading,
    isLoadingMore: state.isLoadingMore,
    error: state.error,
    // Pagination info
    hasMore: state.hasMore && !fetchParams?.searchId,
    total: state.total,
    count: state.data.length,
    // Search info
    isSearching: !!fetchParams?.searchId,
    searchId: fetchParams?.searchId,
    // Actions
    loadMore,
    refresh,
    refreshRequests: refresh,
  }
}

// Listings Hook with Cursor Pagination and Search ID
export const useFetchListingsWithCursor = (params?: CursorHookParams) => {
  const activeAccount = useActiveAccount()
  const address = activeAccount?.address
  const currentRequestRef = useRef<string | null>(null)

  const [state, setState] = useState<CursorPaginationState<LoanListing>>({
    data: [],
    nextCursor: null,
    hasMore: true,
    isLoading: false,
    isLoadingMore: false,
    total: 0,
    error: null,
  })

  // Memoize fetch params to prevent unnecessary re-renders
  const fetchParams = useMemo(() => {
    if (!params) return null

    const cleanParams: FetchParams = {}
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") {
        cleanParams[key as keyof FetchParams] = value
      }
    })
    return cleanParams
  }, [params])

  // Create stable request key
  const requestKey = useMemo(() => createRequestKey(fetchParams, "/api/listings"), [fetchParams])

  // Fetch data function
  const fetchData = useCallback(
    async (isLoadMore = false, loadMoreAmount = 100) => {
      if (!fetchParams) return

      const thisRequestKey = `${requestKey}-${Date.now()}-${Math.random()}`
      currentRequestRef.current = thisRequestKey

      // Set loading state
      setState((prev) => ({
        ...prev,
        isLoading: !isLoadMore,
        isLoadingMore: isLoadMore,
        error: null,
      }))

      try {
        const searchLimit = fetchParams.searchId ? 100 : loadMoreAmount
        const cursor = isLoadMore ? state.nextCursor : null

        const result = await fetchWithCursor<LoanListing>(
          "/api/listings",
          fetchParams,
          cursor,
          searchLimit,
          loadMoreAmount === -1,
        )

        // Check if this request is still current
        if (currentRequestRef.current !== thisRequestKey) {
          return // Ignore outdated requests
        }

        setState((prev) => ({
          ...prev,
          data: isLoadMore ? [...prev.data, ...result.data] : result.data,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          isLoading: false,
          isLoadingMore: false,
          total: result.total,
          error: null,
        }))
      } catch (error) {
        // Only update state if this is still the current request
        if (currentRequestRef.current === thisRequestKey) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isLoadingMore: false,
            error: error instanceof Error ? error.message : "Failed to load listings",
          }))
        }
      }
    },
    [fetchParams, requestKey, state.nextCursor],
  )

  // Load more data
  const loadMore = useCallback(
    async (amount: number) => {
      if (!fetchParams || fetchParams.searchId || !state.hasMore || state.isLoadingMore) {
        return
      }
      await fetchData(true, amount === -1 ? 0 : amount)
    },
    [fetchParams, state.hasMore, state.isLoadingMore, fetchData],
  )

  // Refresh all data
  const refresh = useCallback(() => {
    if (!fetchParams) return

    setState((prev) => ({
      ...prev,
      data: [],
      nextCursor: null,
      hasMore: true,
      total: 0,
      error: null,
    }))

    fetchData(false, 100)
  }, [fetchParams, fetchData])

  // Initialize and re-fetch when params change
  useEffect(() => {
    if (fetchParams) {
      fetchData(false, 100)
    } else {
      // Reset state when no params
      setState({
        data: [],
        nextCursor: null,
        hasMore: true,
        isLoading: false,
        isLoadingMore: false,
        total: 0,
        error: null,
      })
    }
  }, [fetchParams, requestKey]) // Include requestKey to trigger re-fetch when it changes

  // Derived data
  const myListings = useMemo(() => {
    if (!address || !state.data.length) return []
    return state.data.filter((listing) => listing.sender?.toLowerCase() === address.toLowerCase())
  }, [state.data, address])

  const openListings = useMemo(() => {
    return state.data.filter((listing) => listing.status === "OPEN")
  }, [state.data])

  return {
    // Data
    listings: state.data,
    openListings,
    myListings,
    // Loading states
    loading: state.isLoading,
    isLoadingMore: state.isLoadingMore,
    error: state.error,
    // Pagination info
    hasMore: state.hasMore && !fetchParams?.searchId,
    total: state.total,
    count: state.data.length,
    // Search info
    isSearching: !!fetchParams?.searchId,
    searchId: fetchParams?.searchId,
    // Actions
    loadMore,
    refresh,
    refreshListings: refresh,
    // Additional compatibility properties
    myLendOrder: {
      loadings: state.isLoading,
      data: myListings,
    },
  }
}

// Backward compatibility exports
export const useFetchAllRequests = useFetchRequestsWithCursor
export const useFetchAllListings = useFetchListingsWithCursor
export default useFetchRequestsWithCursor
