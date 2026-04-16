"use client"
import { useEffect, useState, useCallback, useMemo } from "react"
import { useActiveAccount } from "thirdweb/react"
import { useAtom } from "jotai"
import {
  selectedTokenAtom,
  selectedOrderAtom,
  activeTableAtom,
  interestAtom,
  selectedVolumeRangesAtom,
  filterByOwnerAtom,
  searchByIdAtom,
  currentPageAtom,
  filtervolumebyOrder, // Add this import
} from "@/constants/atom"
import { useFetchListingsWithCursor, useFetchRequestsWithCursor } from "@/hooks/useFetchRequestWithCursor"
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth"
import { Request, LoanListing } from "@/constants/types"
import { ADDRESS_1 } from "@/constants/utils/addresses"
import { getOverdue } from "@/constants/utils/formatOderDate"
import { formatAmounts } from "@/constants/utils/formatpoints"

interface FilterOptions {
  token: string
  order: string
  interestRate: number
  volumeRanges: Array<{ min: number; max: number }>
  ownerFilter: boolean
  volumeOrder: string // Add this new property
  address?: string
}

interface FilteredData<T> {
  data: T[]
  filteredData: T[]
  paginatedData: T[]
  loading: boolean
  error: string | null
  total: number
  filteredTotal: number
  currentPage: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
  hasMore: boolean
  isLoadingMore: boolean
  address?: string
}

const ITEMS_PER_PAGE = 6

export const useEnhancedCardData = () => {
  const activeAccount = useActiveAccount()
  const address = activeAccount?.address
  const { etherPrice, usdcPrice } = useGetValueAndHealth()

  // Global filter atoms
  const [selectedToken] = useAtom(selectedTokenAtom)
  const [selectedOrder] = useAtom(selectedOrderAtom)
  const [activeTable] = useAtom(activeTableAtom)
  const [interestRate] = useAtom(interestAtom)
  const [selectedVolumeRanges] = useAtom(selectedVolumeRangesAtom)
  const [filterByOwner] = useAtom(filterByOwnerAtom)
  const [searchById] = useAtom(searchByIdAtom)
  const [currentPage, setCurrentPage] = useAtom(currentPageAtom)
  const [volumeOrder] = useAtom(filtervolumebyOrder) // Add this

  // Memoized parameters with search ID support and owner filtering
  const borrowParams = useMemo(
    () => ({
      status: "OPEN",
      searchId: searchById || undefined,
      ...(filterByOwner && address ? { sender: address } : {}),
    }),
    [searchById, filterByOwner, address],
  )

  const lendParams = useMemo(
    () => ({
      status: "OPEN,SERVICED",
      searchId: searchById || undefined,
      ...(filterByOwner && address ? { author: address } : {}),
    }),
    [searchById, filterByOwner, address],
  )

  // Use the cursor hooks for data fetching with search parameters
  const borrowData = useFetchListingsWithCursor(borrowParams)
  const lendData = useFetchRequestsWithCursor(lendParams)

  // Stable price data
  const priceData = useMemo(
    () => ({
      ethPrice: Number(etherPrice) || 0,
      usdPrice: Number(usdcPrice) || 1,
    }),
    [etherPrice, usdcPrice],
  )

  // Volume calculation helper
  const calculateVolume = useCallback(
    (item: any) => {
      try {
        const amount = Number(formatAmounts(item.amount, item.tokenAddress, true) ?? 0)
        if (amount <= 0) return 0
        const isEth = item.tokenAddress?.toLowerCase() === ADDRESS_1.toLowerCase()
        const price = isEth ? priceData.ethPrice : priceData.usdPrice
        return amount * price
      } catch (error) {
        console.warn("Error calculating volume:", error)
        return 0
      }
    },
    [priceData],
  )

  // Volume sorting helper
  const sortByVolume = useCallback(
    <T extends Request | LoanListing>(data: T[], order: string): T[] => {
      const sortedData = [...data].sort((a, b) => {
        const volumeA = calculateVolume(a)
        const volumeB = calculateVolume(b)

        if (order === "Highest") {
          return volumeB - volumeA // Descending order (highest first)
        } else {
          return volumeA - volumeB // Ascending order (lowest first)
        }
      })

      return sortedData
    },
    [calculateVolume],
  )

  // Memoized filter options (including volume order)
  const filterOptions = useMemo(
    () => ({
      token: selectedToken,
      order: selectedOrder,
      interestRate: interestRate,
      volumeRanges: selectedVolumeRanges,
      ownerFilter: filterByOwner,
      volumeOrder: volumeOrder, // Add this
      address: address,
    }),
    [selectedToken, selectedOrder, interestRate, selectedVolumeRanges, filterByOwner, volumeOrder, address],
  )

  // Generic filter function
  const applyFilters = useCallback(
    <T extends Request | LoanListing>(data: T[], options: FilterOptions): T[] => {
      if (!Array.isArray(data) || data.length === 0) return []

      // If searching by ID or filtering by owner, skip most client-side filtering
      if ((searchById && searchById.trim()) || filterByOwner) {
        // Still apply volume sorting even for search results
        return sortByVolume(data, options.volumeOrder)
      }

      let filteredData = data.filter((item) => {
        if (!item) return false

        const [overdueMessage, isOverdue] = getOverdue(item.returnDate)

        // Token filter
        const tokenMatch =
          options.token === "All Tokens" || item.tokenAddress?.toLowerCase() === options.token?.toLowerCase()
        if (!tokenMatch) return false

        // Order/Status filter
        let orderMatch = true
        if (options.order !== "All Orders") {
          const orderUpper = options.order.toUpperCase()
          const statusUpper = item.status?.toUpperCase()
          orderMatch =
            statusUpper === orderUpper ||
            overdueMessage?.toUpperCase() === orderUpper ||
            (orderUpper === "OVERDUE" && isOverdue)
        }
        if (!orderMatch) return false

        // Interest rate filter
        const itemInterest = Number(item.interest) || 0
        const maxInterest = options.interestRate * 100
        const interestMatch = options.interestRate >= 100 || (itemInterest >= 0 && itemInterest <= maxInterest)
        if (!interestMatch) return false

        // Volume filter
        let volumeMatch = true
        if (options.volumeRanges.length > 0) {
          const volume = calculateVolume(item)
          volumeMatch = options.volumeRanges.some(({ min, max }) => volume >= min && volume < max)
        }
        if (!volumeMatch) return false

        return true
      })

      // Apply volume sorting to filtered data
      return sortByVolume(filteredData, options.volumeOrder)
    },
    [calculateVolume, searchById, filterByOwner, sortByVolume],
  )

  // Apply filters to data
  const filteredBorrowData = useMemo(() => {
    return applyFilters(borrowData.listings || [], filterOptions)
  }, [borrowData.listings, filterOptions, applyFilters])

  const filteredLendData = useMemo(() => {
    return applyFilters(lendData.requests || [], filterOptions)
  }, [lendData.requests, filterOptions, applyFilters])

  // Reset page when filters change (including volume order)
  useEffect(() => {
    setCurrentPage(1)
  }, [
    selectedToken,
    selectedOrder,
    interestRate,
    selectedVolumeRanges,
    filterByOwner,
    searchById,
    volumeOrder,
    setCurrentPage,
  ])

  // Pagination helper
  const getPaginatedData = useCallback(
    <T,>(data: T[], page: number, rawData: any): FilteredData<T> => {
      const startIndex = (page - 1) * ITEMS_PER_PAGE
      const endIndex = startIndex + ITEMS_PER_PAGE
      const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE)

      return {
        data: data,
        filteredData: data,
        paginatedData: data.slice(startIndex, endIndex),
        loading: rawData.loading,
        error: rawData.error,
        total: rawData.total || data.length,
        filteredTotal: data.length,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        hasMore: rawData.hasMore || false,
        isLoadingMore: rawData.isLoadingMore || false,
        address: address,
      }
    },
    [address],
  )

  // Get current data based on active table
  const getCurrentData = useCallback(() => {
    if (activeTable === "lend") {
      const paginatedData = getPaginatedData(filteredLendData, currentPage, lendData)
      return {
        ...paginatedData,
        type: "lend" as const,
        isSearching: lendData.isSearching || false,
        searchId: lendData.searchId || null,
        isOwnerFiltered: filterByOwner,
      }
    } else {
      const paginatedData = getPaginatedData(filteredBorrowData, currentPage, borrowData)
      return {
        ...paginatedData,
        type: "borrow" as const,
        isSearching: borrowData.isSearching || false,
        searchId: borrowData.searchId || null,
        isOwnerFiltered: filterByOwner,
      }
    }
  }, [
    activeTable,
    filteredLendData,
    filteredBorrowData,
    currentPage,
    getPaginatedData,
    lendData,
    borrowData,
    filterByOwner,
  ])

  // Pagination controls
  const goToPage = useCallback(
    (page: number) => {
      setCurrentPage(page)
    },
    [setCurrentPage],
  )

  const nextPage = useCallback(() => {
    const currentData = getCurrentData()
    if (currentData.hasNextPage) {
      setCurrentPage((prev) => prev + 1)
    }
  }, [getCurrentData, setCurrentPage])

  const prevPage = useCallback(() => {
    const currentData = getCurrentData()
    if (currentData.hasPrevPage) {
      setCurrentPage((prev) => prev - 1)
    }
  }, [getCurrentData, setCurrentPage])

  // Load more functionality for cursor-based pagination
  const loadMore = useCallback(
    (amount: number = 50) => {
      if ((searchById && searchById.trim()) || filterByOwner) {
        console.log("Load more disabled during ID search or owner filtering")
        return
      }
      if (activeTable === "lend") {
        if (lendData.hasMore && !lendData.isLoadingMore) {
          lendData.loadMore(amount)
        }
      } else {
        if (borrowData.hasMore && !borrowData.isLoadingMore) {
          borrowData.loadMore(amount)
        }
      }
    },
    [activeTable, lendData, borrowData, searchById, filterByOwner],
  )

  // Refresh data
  const refresh = useCallback(() => {
    borrowData.refresh()
    lendData.refresh()
  }, [borrowData.refresh, lendData.refresh])

  // Search-specific states
  const isSearchActive = useMemo(() => {
    return !!(searchById && searchById.trim())
  }, [searchById])

  // Owner filter specific states
  const isOwnerFilterActive = useMemo(() => {
    return filterByOwner && !!address
  }, [filterByOwner, address])

  return {
    // Current active data
    currentData: getCurrentData(),
    // Individual datasets
    borrowData: {
      ...borrowData,
      filteredData: filteredBorrowData,
      paginatedData: getPaginatedData(filteredBorrowData, currentPage, borrowData),
      isSearching: borrowData.isSearching || false,
      searchId: borrowData.searchId || null,
      isOwnerFiltered: filterByOwner,
    },
    lendData: {
      ...lendData,
      filteredData: filteredLendData,
      paginatedData: getPaginatedData(filteredLendData, currentPage, lendData),
      isSearching: lendData.isSearching || false,
      searchId: lendData.searchId || null,
      isOwnerFiltered: filterByOwner,
    },
    // Filter states
    filterOptions,
    activeTable,
    currentPage,
    // Search states
    isSearchActive,
    searchById,
    // Owner filter states
    isOwnerFilterActive,
    filterByOwner,
    // Volume order state
    volumeOrder,
    // Actions
    goToPage,
    nextPage,
    prevPage,
    loadMore,
    refresh,
    setCurrentPage,
    // Statistics
    stats: {
      totalBorrowItems: borrowData.listings?.length || 0,
      filteredBorrowItems: filteredBorrowData.length,
      totalLendItems: lendData.requests?.length || 0,
      filteredLendItems: filteredLendData.length,
      filterEfficiency: {
        borrow: borrowData.listings?.length
          ? ((filteredBorrowData.length / borrowData.listings.length) * 100).toFixed(1) + "%"
          : "0%",
        lend: lendData.requests?.length
          ? ((filteredLendData.length / lendData.requests.length) * 100).toFixed(1) + "%"
          : "0%",
      },
      searchMode: isSearchActive ? "ID_SEARCH" : isOwnerFilterActive ? "OWNER_FILTER" : "NORMAL",
      searchQuery: searchById || null,
      ownerAddress: isOwnerFilterActive ? address : null,
      volumeSort: volumeOrder, // Add this for debugging
    },
    // Raw data access
    rawBorrowData: borrowData,
    rawLendData: lendData,
  }
}
