"use client"

import { useState, useEffect, useMemo } from "react"
import { useActiveAccount } from "thirdweb/react"
import { useFetchListingsWithCursor, useFetchRequestsWithCursor } from "@/hooks/useFetchRequestWithCursor"
import { formatDate } from "@/constants/utils/formatDDMMYY"
import { correctFormattedAmount } from "@/constants/utils/formatTokenDecimals"
import { Spinner } from "@radix-ui/themes"
import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"

// Import all original order components
import OhNo from "@/components/order/OhNo"
import OrdersDetails from "@/components/order/OrdersDetails"
import PendingRepayments from "@/components/order/PendingRepayments"
import TransactionHistory from "@/components/order/TransactionHistory"

interface MyOrdersModalProps {
  isOpen: boolean
  onClose: () => void
  onCreateOrder?: () => void
}

export default function MyOrdersModal({ isOpen, onClose, onCreateOrder }: MyOrdersModalProps) {
  const activeAccount = useActiveAccount()
  const address = activeAccount?.address
  const [isClient, setIsClient] = useState(false)
  const [activeTab, setActiveTab] = useState<'active' | 'history' | 'transactions'>('active')

  useEffect(() => {
    setIsClient(true)
  }, [])

  // Only enable fetching when we have both client-side rendering and an address
  const shouldFetch = Boolean(address && isClient)

  // Memoize fetch parameters to prevent unnecessary re-renders
  // FIXED: Use 'sender' instead of 'lender' to match API route expectations
  const listingsParams = useMemo(() => {
    if (!shouldFetch || !address) return undefined
    return { sender: address } // Changed from 'lender' to 'sender'
  }, [shouldFetch, address])

  const requestsParams = useMemo(() => {
    if (!shouldFetch || !address) return undefined
    return { author: address }
  }, [shouldFetch, address])

  // Fetch data only when parameters are defined
  const {
    listings: userListings,
    loading: listingsLoading,
    error: listingsError,
  } = useFetchListingsWithCursor(listingsParams)

  const {
    requests: userRequests,
    loading: requestsLoading,
    error: requestsError,
  } = useFetchRequestsWithCursor(requestsParams)

  // Combined loading state
  const isLoading = listingsLoading || requestsLoading

  // Merge lend and borrow orders, tag with type
  const mergedOrders = useMemo(() => {
    if (!shouldFetch || !userListings || !userRequests) return []

    const lendOrders = userListings.map((order) => ({ ...order, type: "Lend" }))
    const borrowOrders = userRequests.map((order) => ({ ...order, type: "Borrow" }))
    return [...lendOrders, ...borrowOrders]
  }, [userListings, userRequests, shouldFetch])

  // Sort orders by returnDate descending
  const sortedOrders = useMemo(() => {
    return mergedOrders.sort((a, b) => b.returnDate - a.returnDate)
  }, [mergedOrders])

  // Format orders for display
  const formattedOrders = useMemo(() => {
    return sortedOrders.map((order) => ({
      ...order,
      returnDateFormatted: formatDate(order.returnDate),
      amountFormatted: correctFormattedAmount(order.amount, order.tokenAddress),
    }))
  }, [sortedOrders])

  // Calculate order summary for the button
  const orderSummary = useMemo(() => {
    const openOrders = formattedOrders.filter(order => order.status === "OPEN")
    const filledOrders = formattedOrders.filter(order => order.status === "SERVICED")
    const closedOrders = formattedOrders.filter(order => order.status === "CLOSED")
    
    return {
      total: formattedOrders.length,
      open: openOrders.length,
      filled: filledOrders.length,
      closed: closedOrders.length
    }
  }, [formattedOrders])

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-6xl max-h-[90vh] -translate-x-1/2 -translate-y-1/2 bg-black/40 backdrop-blur-md border border-[#00ff99]/20 rounded-xl overflow-hidden shadow-2xl shadow-black/50">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-[#00ff99]/10">
            <div>
              <Dialog.Title className="text-2xl font-bold text-white">
                My Orders
              </Dialog.Title>
              <p className="text-gray-400 mt-1">
                Total: {orderSummary.total} | Open: {orderSummary.open} | Filled: {orderSummary.filled} | Closed: {orderSummary.closed}
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                className="rounded-full p-2 hover:bg-[#2a2a2a] transition-colors"
                aria-label="Close"
              >
                <X className="h-6 w-6 text-gray-400" />
              </button>
            </Dialog.Close>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-[#00ff99]/10">
            <button
              onClick={() => setActiveTab('active')}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === 'active'
                  ? 'text-white border-b-2 border-[#00ff99]'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Active Orders
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === 'history'
                  ? 'text-white border-b-2 border-[#00ff99]'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Order History
            </button>
            <button
              onClick={() => setActiveTab('transactions')}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === 'transactions'
                  ? 'text-white border-b-2 border-[#00ff99]'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Transaction History
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
            {isLoading ? (
              <div className="flex h-32 items-center justify-center gap-3 text-center">
                <Spinner size={"3"} />
                <p className="text-gray-500">Fetching my orders...</p>
              </div>
            ) : (
              <div>
                {formattedOrders.length > 0 ? (
                  <div>
                    {activeTab === 'active' && (
                      <div className="space-y-6">
                        {/* Orders Details - Only show Open Orders and Create Order */}
                        <div className="min-h-[70vh] w-full bg-transparent px-2 py-6 md:px-8">
                          <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:gap-6">
                            {/* Orders column */}
                            <div className="flex w-full flex-col gap-6 md:w-3/4">
                              <div className="rounded-2xl bg-black/20 backdrop-blur-sm border border-white/5 px-2 py-4 shadow-lg md:px-6">
                                <OrdersDetails orderSample={formattedOrders} />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Pending Repayments */}
                        <div className="w-full rounded-lg p-4">
                          <PendingRepayments />
                        </div>
                      </div>
                    )}

                    {activeTab === 'history' && (
                      <div className="min-h-[70vh] w-full bg-transparent px-2 py-6 md:px-8">
                        <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:gap-6">
                          {/* Orders column */}
                          <div className="flex w-full flex-col gap-6 md:w-3/4">
                            <div className="rounded-2xl bg-black/20 backdrop-blur-sm border border-white/5 px-2 py-4 shadow-lg md:px-6">
                              <OrdersDetails orderSample={formattedOrders} />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 'transactions' && (
                      <div className="w-full rounded-lg p-4">
                        <TransactionHistory />
                      </div>
                    )}
                  </div>
                ) : (
                  <OhNo onCreateOrder={onCreateOrder} />
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
