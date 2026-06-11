"use client"
import Image from "next/image"
import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { ethers } from "ethers"
import { useAtom } from "jotai"
import { activeTableAtom } from "@/constants/atom"
import { formatAddress } from "@/constants/utils/formatAddress"
import { tokenImageMap } from "@/constants/utils/tokenImageMap"
import { convertbasisPointsToPercentage } from "@/constants/utils/FormatInterestRate"
import { getTimeUntil } from "@/constants/utils/formatOderDate"
import { getOverdue } from "@/constants/utils/formatOderDate"
import { formatAmounts } from "@/constants/utils/formatpoints"
import { ADDRESS_1 } from "@/constants/utils/addresses"
import { Btn2 } from "../shared/Btn2"
import { useEnhancedCardData } from "@/components/market/EnhancedCardlayout"
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth"
import useDataFiltersPanel from "@/hooks/useDataFilterPanel"

// Types
interface ListingData {
  listingId?: string
  requestId?: string
  tokenAddress: string
  amount: string
  interest: number
  status: string
  returnDate: string
  sender?: string
  author?: string
  minAmount?: string
  maxAmount?: string
  totalRepayment?: string
}

// Skeleton Components
const HorizontalRowSkeleton = () => (
  <div>
    <div className="hidden animate-pulse items-center border-b border-[#00ff99]/30 bg-black p-4 lg:flex">
      <div className="flex w-full items-center gap-4">
        <div className="h-10 w-10 rounded-full bg-[#2a2a2a]"></div>
        <div className="w-16">
          <div className="h-4 rounded bg-[#2a2a2a]"></div>
        </div>
        <div className="w-24">
          <div className="h-4 rounded bg-[#2a2a2a]"></div>
        </div>
        <div className="w-32">
          <div className="mb-1 h-4 rounded bg-[#2a2a2a]"></div>
          <div className="h-3 w-3/4 rounded bg-[#2a2a2a]"></div>
        </div>
        <div className="w-16">
          <div className="h-4 rounded bg-[#2a2a2a]"></div>
        </div>
        <div className="w-20">
          <div className="h-4 rounded bg-[#2a2a2a]"></div>
        </div>
        <div className="w-20">
          <div className="h-6 rounded-full bg-[#2a2a2a]"></div>
        </div>
        <div className="w-24">
          <div className="h-8 rounded bg-[#2a2a2a]"></div>
        </div>
      </div>
    </div>
    {/* Mobile Skeleton */}
    <div className="flex animate-pulse flex-col gap-3 border-b border-[#00ff99]/30 bg-black p-4 lg:hidden">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-[#2a2a2a]"></div>
          <div className="h-4 w-16 rounded bg-[#2a2a2a]"></div>
        </div>
        <div className="h-6 w-16 rounded-full bg-[#2a2a2a]"></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="h-8 rounded bg-[#2a2a2a]"></div>
        <div className="h-8 rounded bg-[#2a2a2a]"></div>
        <div className="h-8 rounded bg-[#2a2a2a]"></div>
        <div className="h-8 rounded bg-[#2a2a2a]"></div>
      </div>
      <div className="h-8 rounded bg-[#2a2a2a]"></div>
      <div className="h-10 rounded bg-[#2a2a2a]"></div>
    </div>
  </div>
)

const LoadingSkeleton = ({ count = 10 }: { count?: number }) => (
  <div className="space-y-0">
    {Array.from({ length: count }, (_, i) => (
      <HorizontalRowSkeleton key={i} />
    ))}
  </div>
)

// Enhanced Load More Button Component with Infinite Scroll Support
const LoadMoreButton = ({
  onLoadMore,
  onLoadAll,
  isLoading,
  hasMore,
  currentCount,
  total,
  isInfiniteScrollMode,
}: {
  onLoadMore: (amount: number) => void
  onLoadAll: () => void
  isLoading: boolean
  hasMore: boolean
  currentCount: number
  total: number
  isInfiniteScrollMode: boolean
}) => {
  const loadOptions = [25, 50, 100]
  const remainingCount = total - currentCount

  if (!hasMore || remainingCount <= 0) return null

  // If in infinite scroll mode, show different UI
  if (isInfiniteScrollMode) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="text-sm text-gray-400">
          Showing {currentCount} of {total} total results
        </div>
        {/* <div className="flex items-center gap-2 text-sm text-green-400">
          <div className="h-2 w-2 animate-pulse rounded-full bg-green-400"></div>
          Scroll down to load more automatically
        </div> */}
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-[#FF4D00]"></div>
            Loading more results...
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <div className="text-sm text-gray-400">
        Showing {currentCount} of {total} total results
      </div>
      <div className="flex gap-2">
        {loadOptions
          .filter((amount) => amount <= remainingCount)
          .map((amount) => (
            <button
              key={amount}
              onClick={() => onLoadMore(amount)}
              disabled={isLoading}
              className={`rounded-lg border px-4 py-2 transition-colors ${
                isLoading
                  ? "cursor-not-allowed border-[#00ff99]/30 bg-[#2a2a2a] text-gray-500"
                  : "border-[#00ff99]/30 bg-black text-white hover:border-[#FF4D00] hover:bg-[#2a2a2a]"
              }`}
            >
              Load {amount} more
            </button>
          ))}
        <button
          onClick={onLoadAll}
          disabled={isLoading}
          className={`rounded-lg border px-4 py-2 transition-colors ${
            isLoading
              ? "cursor-not-allowed border-[#00ff99]/30 bg-[#2a2a2a] text-gray-500"
              : "border-[#FF4D00] bg-[#FF4D00] text-black hover:bg-[#FF6D20]"
          }`}
        >
          Load All
        </button>
      </div>
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-[#FF4D00]"></div>
          Loading more results...
        </div>
      )}
    </div>
  )
}

// Custom hook for infinite scroll
const useInfiniteScroll = (
  callback: () => void,
  hasMore: boolean,
  isLoading: boolean,
  isEnabled: boolean = true,
  threshold: number = 200,
) => {
  const observerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isEnabled || !hasMore || isLoading) return

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0]
        if (target.isIntersecting) {
          callback()
        }
      },
      {
        rootMargin: `${threshold}px`,
        threshold: 0.1,
      },
    )

    const currentRef = observerRef.current
    if (currentRef) {
      observer.observe(currentRef)
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef)
      }
    }
  }, [callback, hasMore, isLoading, isEnabled, threshold])

  return observerRef
}

// Individual Row Components (keeping your existing components)
const BorrowRow = ({ data, address, etherPrice, usdcPrice, onCloseAd, index, filters }: any) => {
  const tokenInfo = useMemo(() => tokenImageMap[data.tokenAddress], [data.tokenAddress])

  const statusInfo = useMemo(() => {
    const statusLabels: Record<string, { text: string; color: string }> = {
      OPEN: { text: "Open", color: "bg-green-500" },
      SERVICED: { text: "Serviced", color: "bg-yellow-500" },
      OVERDUE: { text: "Overdue", color: "bg-red-500" },
    }
    const [message, isOverdue] = getOverdue(data.returnDate)
    const statusKey = data.status || message
    const overrideStatus = data.status === "OPEN" && isOverdue ? "OVERDUE" : statusKey
    const status = statusLabels[overrideStatus as string] || {
      text: overrideStatus || "Unknown",
      color: "bg-[#2a2a2a]",
    }
    return { status, isOverdue }
  }, [data.status, data.returnDate])

  const priceCalculations = useMemo(() => {
    // Use the props passed to the component instead of accessing filters directly
    const ethPrice = Number(filters?.etherPrice) || 0
    const usdPrice = Number(filters?.usdcPrice) || 0
    const basePrice = tokenInfo?.label === "ETH" ? ethPrice : usdPrice
    const amount = Number(ethers.formatEther(data.amount))
    const minAmount = formatAmounts(data.minAmount, data.tokenAddress, true)
    const maxAmount = formatAmounts(data.maxAmount, data.tokenAddress, true)

    return {
      volumeUSD: (amount * basePrice * (tokenInfo?.label === "ETH" ? 1 : 1e12)).toFixed(2),
      minUSD: (Number(minAmount) * basePrice).toFixed(2),
      maxUSD: (Number(maxAmount) * basePrice).toFixed(2),
      volumeDisplay: tokenInfo?.label === "ETH" ? amount.toFixed(4) : (amount * 1e12).toFixed(3),
      minDisplay: formatAmounts(data.minAmount, data.tokenAddress),
      maxDisplay: formatAmounts(data.maxAmount, data.tokenAddress),
    }
  }, [
    data.amount,
    data.minAmount,
    data.maxAmount,
    tokenInfo?.label,
    filters?.etherPrice,
    filters?.usdcPrice,
    data.tokenAddress,
  ])

  const canCloseAd = useMemo(() => {
    return data.sender?.toLowerCase() === address?.toLowerCase()
  }, [data.sender, data.author, data.status, address]) // Use address prop instead of filters?.address

  return (
    <>
      {/* Desktop Layout - Hidden on mobile */}
      <div className="hidden w-full items-center border-b border-[#00ff99]/30 bg-black p-4 transition-colors hover:bg-[#2a2a2a] lg:flex">
        <div className="flex w-full items-center gap-4 lg:gap-6">
          {/* Token Info */}
          <div className="flex w-20 items-center gap-3 lg:w-24">
            <Image
              src={tokenInfo?.image || "/Eye.svg"}
              alt={tokenInfo?.label || "Token"}
              width={32}
              height={32}
              className="rounded-full"
            />
            <span className="hidden font-medium sm:block">{tokenInfo?.label || "N/A"}</span>
          </div>

          {/* Origin */}
          <div className="w-24 lg:w-32">
            <div className="text-xs text-gray-400">Origin</div>
            <div className="font-medium">{formatAddress(data.sender)}</div>
          </div>

          {/* Volume Range */}
          <div className="w-32 lg:w-40">
            <div className="text-xs text-gray-400">Volume Range</div>
            <div className="font-medium">
              {priceCalculations.minDisplay} - {priceCalculations.maxDisplay}
            </div>
            <div className="text-xs text-gray-500">
              ${priceCalculations.minUSD} - ${priceCalculations.maxUSD}
            </div>
          </div>

          {/* Available */}
          <div className="w-28 lg:w-32">
            <div className="text-xs text-gray-400">Available</div>
            <div className="font-medium">
              {priceCalculations.volumeDisplay} {tokenInfo?.label}
            </div>
            <div className="text-xs text-gray-500">${priceCalculations.volumeUSD}</div>
          </div>

          {/* Rate */}
          <div className="w-16 lg:w-20">
            <div className="text-xs text-gray-400">Rate</div>
            <div className="font-medium text-green-400">{convertbasisPointsToPercentage(data.interest)}%</div>
          </div>

          {/* Duration */}
          <div className="w-20 lg:w-24">
            <div className="text-xs text-gray-400">Duration</div>
            <div className="text-sm">{getTimeUntil(data.returnDate)}</div>
          </div>

          {/* Status */}
          <div className="w-20 lg:w-24">
            <span
              className={`inline-block rounded-full px-2 py-1 text-xs font-medium text-white ${statusInfo.status.color}`}
            >
              {statusInfo.status.text}
            </span>
          </div>

          {/* Actions */}
          <div className="flex w-24 gap-2 lg:w-32">
            <button
              onClick={() => {
                if (address) {
                  filters?.handleBorrowAllocation(data);
                }
              }}
              disabled={statusInfo.isOverdue}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                statusInfo.isOverdue
                  ? "cursor-not-allowed bg-[#2a2a2a] text-gray-400"
                  : "bg-[#FF4D00] text-black hover:bg-[#FF6D20]"
              } ${!address ? 'opacity-70' : ''}`}
            >
              {address ? "Borrow" : "Connect"}
            </button>

            {filters?.address === data.sender ? (
              <button
                onClick={() => filters?.closeListingAd(data.listingId)}
                className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700"
              >
                Close
              </button>
            ) : (
              ""
            )}
          </div>

          {/* ID */}
          <div className="hidden w-16 text-xs text-gray-500 lg:block">#{data.listingId}</div>
        </div>
      </div>

      {/* Mobile Card Layout - Hidden on desktop */}
      <div className="flex flex-col border-b border-[#00ff99]/30 bg-black p-4 lg:hidden">
        {/* Header Row */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src={tokenInfo?.image || "/Eye.svg"}
              alt={tokenInfo?.label || "Token"}
              width={32}
              height={32}
              className="rounded-full"
            />
            <div>
              <div className="font-medium">{tokenInfo?.label || "N/A"}</div>
              <div className="text-xs text-gray-400">#{data.listingId}</div>
            </div>
          </div>
          <span
            className={`inline-block rounded-full px-2 py-1 text-xs font-medium text-white ${statusInfo.status.color}`}
          >
            {statusInfo.status.text}
          </span>
        </div>

        {/* Info Grid */}
        <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-gray-400">Origin</div>
            <div className="font-medium">{formatAddress(data.sender)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Rate</div>
            <div className="font-medium text-green-400">{convertbasisPointsToPercentage(data.interest)}%</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Available</div>
            <div className="font-medium">
              {priceCalculations.volumeDisplay} {tokenInfo?.label}
            </div>
            <div className="text-xs text-gray-500">${priceCalculations.volumeUSD}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Duration</div>
            <div className="text-sm">{getTimeUntil(data.returnDate)}</div>
          </div>
        </div>

        {/* Range Info */}
        <div className="mb-3">
          <div className="text-xs text-gray-400">Volume Range</div>
          <div className="font-medium">
            {priceCalculations.minDisplay} - {priceCalculations.maxDisplay}
          </div>
          <div className="text-xs text-gray-500">
            ${priceCalculations.minUSD} - ${priceCalculations.maxUSD}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (address) {
                filters?.handleBorrowAllocation(data);
              }
            }}
            disabled={statusInfo.isOverdue}
            className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${
              statusInfo.isOverdue
                ? "cursor-not-allowed bg-[#2a2a2a] text-gray-400"
                : "bg-[#FF4D00] text-black hover:bg-[#FF6D20]"
            } ${!address ? 'opacity-70' : ''}`}
          >
            {address ? "Borrow" : "Connect"}
          </button>

          {filters?.address === data.sender ? (
            <button
              onClick={() => filters?.closeListingAd(data.listingId)}
              className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              Close
            </button>
          ) : (
            ""
          )}
        </div>
      </div>
    </>
  )
}

const LendRow = ({ data, filters, index }: any) => {
  const tokenInfo = useMemo(() => tokenImageMap[data.tokenAddress], [data.tokenAddress])

  const statusInfo = useMemo(() => {
    const statusLabels: Record<string, { text: string; color: string }> = {
      OPEN: { text: "Open", color: "bg-green-500" },
      SERVICED: { text: "Serviced", color: "bg-yellow-500" },
      OVERDUE: { text: "Overdue", color: "bg-red-500" },
    }
    const [message, isOverdue] = getOverdue(data.returnDate)
    const statusKey = data.status || message
    const overrideStatus = data.status === "OPEN" && isOverdue ? "OVERDUE" : statusKey
    const status = statusLabels[overrideStatus as string] || {
      text: overrideStatus || "Unknown",
      color: "bg-[#2a2a2a]",
    }
    return { status, isOverdue }
  }, [data.status, data.returnDate])

  const priceCalculations = useMemo(() => {
    const ethPrice = Number(filters?.etherPrice) || 0
    const usdPrice = Number(filters?.usdcPrice) || 0
    const filteredAmount = formatAmounts(data.amount, data.tokenAddress)
    const filteredRepayAmount = formatAmounts(data.totalRepayment, data.tokenAddress)
    const basePrice = tokenInfo?.label === "ETH" ? ethPrice : usdPrice * 1e12

    return {
      loanAmountUSD:
        data.tokenAddress === ADDRESS_1
          ? ((data.amount * basePrice) / 1e18).toFixed(4)
          : ((data.amount * basePrice) / 1e18).toFixed(2),
      repaymentUSD:
        data.tokenAddress === ADDRESS_1
          ? ((data.totalRepayment * basePrice) / 1e18).toFixed(4)
          : ((data.totalRepayment * basePrice) / 1e18).toFixed(2),
      loanAmountDisplay: filteredAmount,
      repaymentDisplay: filteredRepayAmount,
    }
  }, [data.amount, data.totalRepayment, data.tokenAddress, tokenInfo?.label, filters?.etherPrice, filters?.usdcPrice])

  const canCloseRequest = useMemo(() => {
    return data.author?.toLowerCase() === filters?.address?.toLowerCase() && data.status === "OPEN"
  }, [data.author, data.status, filters?.address])

  return (
    <>
      {/* Desktop Layout */}

      <div className="hidden items-center border-b border-[#00ff99]/30 bg-black p-4 transition-colors hover:bg-[#2a2a2a] lg:flex">
        <div className="flex w-full items-center gap-4 lg:gap-6">
          {/* Token Info */}
          <div className="flex w-20 items-center gap-3 lg:w-24">
            <Image
              src={tokenInfo?.image || "/Eye.svg"}
              alt={tokenInfo?.label || "Token"}
              width={32}
              height={32}
              className="rounded-full"
            />
            <span className="hidden font-medium sm:block">{tokenInfo?.label || "N/A"}</span>
          </div>

          {/* Origin */}
          <div className="w-24 lg:w-32">
            <div className="text-xs text-gray-400">Borrower</div>
            <div className="font-medium">{formatAddress(data.author)}</div>
          </div>

          {/* Loan Amount */}
          <div className="w-32 lg:w-36">
            <div className="text-xs text-gray-400">Loan Amount</div>
            <div className="font-medium">
              {priceCalculations.loanAmountDisplay} {tokenInfo?.label}
            </div>
            <div className="text-xs text-gray-500">${priceCalculations.loanAmountUSD}</div>
          </div>

          {/* Repayment */}
          <div className="w-32 lg:w-36">
            <div className="text-xs text-gray-400">Repayment</div>
            <div className="font-medium text-green-400">
              {priceCalculations.repaymentDisplay} {tokenInfo?.label}
            </div>
            <div className="text-xs text-gray-500">${priceCalculations.repaymentUSD}</div>
          </div>

          {/* Rate */}
          <div className="w-16 lg:w-20">
            <div className="text-xs text-gray-400">Rate</div>
            <div className="font-medium text-green-400">{convertbasisPointsToPercentage(data.interest)}%</div>
          </div>

          {/* Duration */}
          <div className="w-20 lg:w-24">
            <div className="text-xs text-gray-400">Duration</div>
            <div className="text-sm">{getTimeUntil(data.returnDate)}</div>
          </div>

          {/* Status */}
          <div className="w-20 lg:w-24">
            <span
              className={`inline-block rounded-full px-2 py-1 text-xs font-medium text-white ${statusInfo.status.color}`}
            >
              {statusInfo.status.text}
            </span>
          </div>

          {/* Actions */}
          <div className="flex w-24 gap-2 lg:w-32">
            <button
              onClick={() => {
                if (filters?.address && data.status !== "SERVICED") {
                  filters?.serviceRequest(data.requestId, String(data.tokenAddress), data.amount)
                }
              }}
              disabled={data.status === "SERVICED"}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                data.status === "SERVICED"
                  ? "cursor-not-allowed bg-[#2a2a2a] text-gray-400"
                  : "bg-[#FF4D00] text-black hover:bg-[#FF6D20]"
              } ${!filters?.address ? 'opacity-70' : ''}`}
            >
              {filters?.address ? "Lend" : "Connect"}
            </button>
            {filters?.address === data.author ? (
              <button
                onClick={() => filters?.closeRequest(data.requestId)}
                className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700"
              >
                Close
              </button>
            ) : (
              ""
            )}
          </div>

          {/* ID - Hidden on small screens */}
          <div className="hidden w-16 text-xs text-gray-500 lg:block">#{data.requestId}</div>
        </div>
      </div>

      {/* Mobile Card Layout */}
      <div className="flex flex-col border-b border-[#00ff99]/30 bg-black p-4 lg:hidden">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src={tokenInfo?.image || "/Eye.svg"}
              alt={tokenInfo?.label || "Token"}
              width={32}
              height={32}
              className="rounded-full"
            />
            <div>
              <div className="font-medium">{tokenInfo?.label || "N/A"}</div>
              <div className="text-xs text-gray-400">#{data.requestId}</div>
            </div>
          </div>
          <span
            className={`inline-block rounded-full px-2 py-1 text-xs font-medium text-white ${statusInfo.status.color}`}
          >
            {statusInfo.status.text}
          </span>
        </div>

        {/* Info Grid */}
        <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-gray-400">Borrower</div>
            <div className="font-medium">{formatAddress(data.author)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Rate</div>
            <div className="font-medium text-green-400">{convertbasisPointsToPercentage(data.interest)}%</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Loan Amount</div>
            <div className="font-medium">
              {priceCalculations.loanAmountDisplay} {tokenInfo?.label}
            </div>
            <div className="text-xs text-gray-500">${priceCalculations.loanAmountUSD}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Duration</div>
            <div className="text-sm">{getTimeUntil(data.returnDate)}</div>
          </div>
        </div>

        {/* Repayment Info */}
        <div className="mb-3">
          <div className="text-xs text-gray-400">Repayment</div>
          <div className="font-medium text-green-400">
            {priceCalculations.repaymentDisplay} {tokenInfo?.label}
          </div>
          <div className="text-xs text-gray-500">${priceCalculations.repaymentUSD}</div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (filters?.address && data.status !== "SERVICED") {
                filters?.serviceRequest(data.requestId, String(data.tokenAddress), data.amount)
              }
            }}
            disabled={data.status === "SERVICED"}
            className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${
              data.status === "SERVICED"
                ? "cursor-not-allowed bg-[#2a2a2a] text-gray-400"
                : "bg-[#FF4D00] text-black hover:bg-[#FF6D20]"
            } ${!filters?.address ? 'opacity-70' : ''}`}
          >
            {filters?.address ? "Lend" : "Connect"}
          </button>
          {canCloseRequest && (
            <button
              onClick={() => filters?.closeRequest(data.requestId)}
              className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </>
  )
}

// Main Component with Infinite Scroll
const HorizontalListingLayout = () => {
  // Use the filters panel hook
  const filters = useDataFiltersPanel()

  // Use the enhanced card data hook for filtering
  const hookData = useEnhancedCardData()
  const { borrowData, lendData, activeTable, refresh, loadMore, stats, rawBorrowData, rawLendData } = hookData

  // Get price data
  const { etherPrice, usdcPrice } = useGetValueAndHealth()

  // Get current user address - we'll get this from the hook data
  const [activeTableState, setActiveTableState] = useAtom(activeTableAtom)

  // Infinite scroll state
  const [isInfiniteScrollMode, setIsInfiniteScrollMode] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Get current filtered data based on active table
  const currentData = useMemo(() => {
    if (activeTable === "lend") {
      return {
        data: lendData.filteredData || [],
        count: lendData.filteredData?.length || 0,
        loading: rawLendData.loading,
        error: rawLendData.error,
        hasMore: rawLendData.hasMore,
        isLoadingMore: rawLendData.isLoadingMore,
        total: rawLendData.total || 0,
        address: undefined, // We'll handle this differently
      }
    } else {
      return {
        data: borrowData.filteredData || [],
        count: borrowData.filteredData?.length || 0,
        loading: rawBorrowData.loading,
        error: rawBorrowData.error,
        hasMore: rawBorrowData.hasMore,
        isLoadingMore: rawBorrowData.isLoadingMore,
        total: rawBorrowData.total || 0,
        address: undefined, // We'll handle this differently
      }
    }
  }, [activeTable, borrowData, lendData, rawBorrowData, rawLendData])

  // Infinite scroll callback
  const handleInfiniteScroll = useCallback(() => {
    if (isInfiniteScrollMode && currentData.hasMore && !currentData.isLoadingMore) {
      loadMore(800) // Load 50 more items at a time during infinite scroll
    }
  }, [isInfiniteScrollMode, currentData.hasMore, currentData.isLoadingMore, loadMore])

  // Setup infinite scroll observer
  const infiniteScrollRef = useInfiniteScroll(
    handleInfiniteScroll,
    currentData.hasMore,
    currentData.isLoadingMore,
    isInfiniteScrollMode,
  )

  // Handle Load All (switch to infinite scroll mode)
  const handleLoadAll = useCallback(() => {
    setIsInfiniteScrollMode(true)
    // Load more data immediately to start the infinite scroll
    if (currentData.hasMore && !currentData.isLoadingMore) {
      loadMore(100) // Load a bigger chunk initially
    }
  }, [currentData.hasMore, currentData.isLoadingMore, loadMore])

  // Tab switching - reset infinite scroll mode
  const handleTabSwitch = useCallback(
    (tab: "borrow" | "lend") => {
      if (tab !== activeTable) {
        setActiveTableState(tab)
        setIsInfiniteScrollMode(false) // Reset infinite scroll when switching tabs
      }
    },
    [activeTable, setActiveTableState],
  )

  // Reset infinite scroll mode on refresh
  const handleRefresh = useCallback(() => {
    setIsInfiniteScrollMode(false)
    refresh()
  }, [refresh])

  // Error handling
  if (currentData.error) {
    return (
      <div className="w-full py-5">
        <div className="flex flex-col items-center justify-center px-4 py-16">
          <div className="mb-4 text-6xl">⚠️</div>
          <h3 className="mb-2 text-center text-xl font-semibold text-red-400">Unable to Load Data</h3>
          <p className="mb-4 max-w-md text-center text-gray-400">
            {currentData.error.includes("net::ERR_INSUFFICIENT_RESOURCES")
              ? "Server resources are temporarily unavailable. Please try again later."
              : currentData.error}
          </p>
          <div className="flex gap-4">
            <button
              onClick={handleRefresh}
              className="rounded-lg bg-[#FF4D00] px-4 py-2 text-black transition-colors hover:bg-[#FF6D20]"
            >
              Retry
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-[#2a2a2a] px-4 py-2 text-white transition-colors hover:bg-[#2a2a2a]"
            >
              Reload Page
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Loading state
  if (currentData.loading) {
    return (
      <div className="w-full py-5">
        <div className="px-4 sm:px-12">
          <LoadingSkeleton />
        </div>
      </div>
    )
  }

  return (
    <div className="w-full py-5">
      {/* Header with Tab Switch */}
      <div className="mb-6 flex flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-12">
        <div className="flex w-full space-x-1 rounded-lg bg-[#2a2a2a] p-1 sm:w-auto">
          {/* Tab buttons with responsive text */}
          <button
            className={`flex-1 rounded-md px-4 py-2 text-sm transition-all sm:flex-initial sm:px-6 sm:text-base ${
              activeTable === "borrow" ? "bg-[#FF4D00] font-medium text-black" : "text-gray-400 hover:text-white"
            }`}
            onClick={() => handleTabSwitch("borrow")}
          >
            <span className="sm:hidden">Borrow ({borrowData.listings?.length || 0})</span>
            <span className="hidden sm:inline">
              Borrow ({borrowData.listings?.length || 0}/{borrowData.total || 0})
            </span>
          </button>
          <button
            className={`flex-1 rounded-md px-4 py-2 text-sm transition-all sm:flex-initial sm:px-6 sm:text-base ${
              activeTable === "lend" ? "bg-[#FF4D00] font-medium text-black" : "text-gray-400 hover:text-white"
            }`}
            onClick={() => handleTabSwitch("lend")}
          >
            <span className="sm:hidden">Lend ({lendData.requests?.length || 0})</span>
            <span className="hidden sm:inline">
              Lend ({lendData.requests?.length || 0}/{lendData.total || 0})
            </span>
          </button>
        </div>

        {/* Action buttons - stack on mobile */}
        <div className="flex flex-col gap-2 sm:flex-row">
          {isInfiniteScrollMode && (
            <button
              onClick={() => setIsInfiniteScrollMode(false)}
              className="rounded-lg border border-yellow-600 bg-yellow-900 px-3 py-2 text-sm text-yellow-100 transition-colors hover:bg-yellow-800"
            >
              <span className="sm:hidden">📄 Manual Loading</span>
              <span className="hidden sm:inline">📄 Switch to Manual Loading</span>
            </button>
          )}
          <button
            onClick={handleRefresh}
            className="rounded-lg border border-[#00ff99]/30 bg-[#2a2a2a] px-3 py-2 text-sm text-white transition-colors hover:border-[#FF4D00] hover:bg-[#2a2a2a]"
          >
            Refresh Data
          </button>
        </div>
      </div>

      {/* Table Header - Only show when we have data and no error */}
      {!currentData.error && currentData.count > 0 && (
        <div className="hidden border-b border-[#00ff99]/30 bg-[#2a2a2a] px-4 py-3 sm:px-12 lg:block">
          <div className="flex items-center gap-4 text-xs font-medium uppercase tracking-wider text-gray-400 lg:gap-6">
            <div className="w-20 lg:w-24">Token</div>
            <div className="w-24 lg:w-32">{activeTable === "borrow" ? "Origin" : "Borrower"}</div>
            <div className="w-32 lg:w-40">{activeTable === "borrow" ? "Volume Range" : "Loan Amount"}</div>
            <div className="w-28 lg:w-32">{activeTable === "borrow" ? "Available" : "Repayment"}</div>
            <div className="w-16 lg:w-20">Rate</div>
            <div className="w-20 lg:w-24">Duration</div>
            <div className="w-20 lg:w-24">Status</div>
            <div className="w-24 lg:w-32">Actions</div>
            <div className="hidden w-16 lg:block">ID</div>
          </div>
        </div>
      )}
      <div className="max-h-[70vh] overflow-y-scroll bg-transparent">
        {/* Data Container */}
        <div ref={scrollContainerRef} className="px-4 sm:px-12">
          {/* Empty State - Only show if no data and not loading */}
          {!currentData.loading && !currentData.error && currentData.count === 0 && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 text-6xl">🔍</div>
              <h3 className="mb-2 text-xl font-semibold text-white">
                No {activeTable === "borrow" ? "borrowing" : "lending"} opportunities found
              </h3>
              <p className="max-w-md text-center text-gray-400">
                {stats.totalBorrowItems > 0 || stats.totalLendItems > 0
                  ? "Try adjusting your filters to see more results"
                  : "Try refreshing the data or check back later"}
              </p>
              <div className="mt-2 text-sm text-gray-500">
                Filter efficiency:{" "}
                {activeTable === "lend" ? stats.filterEfficiency.lend : stats.filterEfficiency.borrow}
              </div>
              <button
                onClick={handleRefresh}
                className="mt-4 rounded-lg bg-[#FF4D00] px-4 py-2 text-black transition-colors hover:bg-[#FF6D20]"
              >
                Refresh
              </button>
            </div>
          )}

          {/* Data Rows - Show if we have data and no error */}
          {!currentData.error && currentData.count > 0 && (
            <div className="divide-y divide-gray-800">
              {activeTable === "borrow"
                ? currentData.data.map((data, index) => (
                    <BorrowRow
                      key={`borrow-${data.listingId}-${index}`}
                      data={data}
                      filters={filters}
                      onCloseAd={(id: string) => console.log("Close ad:", id)}
                      index={index}
                    />
                  ))
                : currentData.data.map((data: any, index) => (
                    <LendRow key={`lend-${data.requestId}-${index}`} data={data} filters={filters} index={index} />
                  ))}
            </div>
          )}

          {/* Loading More Skeleton - Only show when actively loading more */}
          {!currentData.error && currentData.isLoadingMore && (
            <div className="border-t border-[#00ff99]/30">
              <LoadingSkeleton count={5} />
            </div>
          )}
        </div>
        {/* Load More Button or Infinite Scroll Indicator */}
        {!currentData.error && !currentData.loading && currentData.count > 0 && currentData.hasMore && (
          <LoadMoreButton
            onLoadMore={loadMore}
            onLoadAll={handleLoadAll}
            isLoading={currentData.isLoadingMore}
            hasMore={currentData.hasMore}
            currentCount={currentData.count}
            total={currentData.total}
            isInfiniteScrollMode={isInfiniteScrollMode}
          />
        )}

        {/* Infinite Scroll Trigger Element */}
        {isInfiniteScrollMode && currentData.hasMore && (
          <div ref={infiniteScrollRef} className="flex h-20 items-center justify-center">
            {/* This invisible element triggers the infinite scroll */}
          </div>
        )}

        {/* End of Results Indicator */}
        {!currentData.error && !currentData.loading && currentData.count > 0 && !currentData.hasMore && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="text-lg">🎉</div>
            <div className="text-center text-gray-400">
              <div className="font-medium">You've reached the end!</div>
              <div className="text-sm">
                Showing all {currentData.count} {activeTable === "borrow" ? "borrowing" : "lending"} opportunities
              </div>
            </div>
            {isInfiniteScrollMode && (
              <button
                onClick={() => setIsInfiniteScrollMode(false)}
                className="rounded-lg border border-[#00ff99]/30 bg-black px-4 py-2 text-sm text-white transition-colors hover:border-[#FF4D00] hover:bg-[#2a2a2a]"
              >
                Switch to Manual Loading
              </button>
            )}
          </div>
        )}

        {/* Filter Stats - Development Only */}
        {/* {process.env.NODE_ENV === "development" && (
          <div className="mt-4 rounded bg-[#2a2a2a] p-4 text-sm text-gray-400">
            <div>
              Showing {currentData.count} filtered results out of{" "}
              {activeTable === "lend" ? stats.totalLendItems : stats.totalBorrowItems} total
            </div>
            <div>
              Filter efficiency: {activeTable === "lend" ? stats.filterEfficiency.lend : stats.filterEfficiency.borrow}
            </div>
            <div>Infinite scroll mode: {isInfiniteScrollMode ? "✅ Active" : "❌ Disabled"}</div>
          </div>
        )} */}
      </div>
    </div>
  )
}

export default HorizontalListingLayout
