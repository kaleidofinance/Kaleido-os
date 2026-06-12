"use client";

import { useState, useEffect, useMemo } from "react";
import { useActiveAccount } from "thirdweb/react";
import {
  useFetchListingsWithCursor,
  useFetchRequestsWithCursor,
} from "@/hooks/useFetchRequestWithCursor";
import { formatDate } from "@/constants/utils/formatDDMMYY";
import { correctFormattedAmount } from "@/constants/utils/formatTokenDecimals";
import { Spinner } from "@radix-ui/themes";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

// Import all original order components
import OhNo from "@/components/order/OhNo";
import OrdersDetails from "@/components/order/OrdersDetails";
import PendingRepayments from "@/components/order/PendingRepayments";
import TransactionHistory from "@/components/order/TransactionHistory";

interface MyOrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateOrder?: () => void;
}

export default function MyOrdersModal({
  isOpen,
  onClose,
  onCreateOrder,
}: MyOrdersModalProps) {
  const activeAccount = useActiveAccount();
  const address = activeAccount?.address;
  const [isClient, setIsClient] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "active" | "history" | "transactions"
  >("active");

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Only enable fetching when we have both client-side rendering and an address
  const shouldFetch = Boolean(address && isClient);

  // Memoize fetch parameters to prevent unnecessary re-renders
  // FIXED: Use 'sender' instead of 'lender' to match API route expectations
  const listingsParams = useMemo(() => {
    if (!shouldFetch || !address) return undefined;
    return { sender: address }; // Changed from 'lender' to 'sender'
  }, [shouldFetch, address]);

  const requestsParams = useMemo(() => {
    if (!shouldFetch || !address) return undefined;
    return { author: address };
  }, [shouldFetch, address]);

  // Fetch data only when parameters are defined
  const {
    listings: userListings,
    loading: listingsLoading,
    error: listingsError,
  } = useFetchListingsWithCursor(listingsParams);

  const {
    requests: userRequests,
    loading: requestsLoading,
    error: requestsError,
  } = useFetchRequestsWithCursor(requestsParams);

  // Combined loading state
  const isLoading = listingsLoading || requestsLoading;

  // Merge lend and borrow orders, tag with type
  const mergedOrders = useMemo(() => {
    if (!shouldFetch || !userListings || !userRequests) return [];

    const lendOrders = userListings.map((order) => ({
      ...order,
      type: "Lend",
    }));
    const borrowOrders = userRequests.map((order) => ({
      ...order,
      type: "Borrow",
    }));
    return [...lendOrders, ...borrowOrders];
  }, [userListings, userRequests, shouldFetch]);

  // Sort orders by returnDate descending
  const sortedOrders = useMemo(() => {
    return mergedOrders.sort((a, b) => b.returnDate - a.returnDate);
  }, [mergedOrders]);

  // Format orders for display
  const formattedOrders = useMemo(() => {
    return sortedOrders.map((order) => ({
      ...order,
      returnDateFormatted: formatDate(order.returnDate),
      amountFormatted: correctFormattedAmount(order.amount, order.tokenAddress),
    }));
  }, [sortedOrders]);

  // Calculate order summary for the button
  const orderSummary = useMemo(() => {
    const openOrders = formattedOrders.filter(
      (order) => order.status === "OPEN",
    );
    const filledOrders = formattedOrders.filter(
      (order) => order.status === "SERVICED",
    );
    const closedOrders = formattedOrders.filter(
      (order) => order.status === "CLOSED",
    );

    return {
      total: formattedOrders.length,
      open: openOrders.length,
      filled: filledOrders.length,
      closed: closedOrders.length,
    };
  }, [formattedOrders]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-[#00ff99]/20 bg-black/60 shadow-2xl shadow-black/50 backdrop-blur-md sm:max-h-[90vh] sm:w-[92vw]">
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#00ff99]/10 p-4 sm:items-center sm:p-6">
            <div>
              <Dialog.Title className="text-xl font-bold text-white sm:text-2xl">
                My Orders
              </Dialog.Title>
              <p className="mt-1 text-xs leading-relaxed text-gray-400 sm:text-base">
                Total: {orderSummary.total} | Open: {orderSummary.open} |
                Filled: {orderSummary.filled} | Closed: {orderSummary.closed}
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                className="shrink-0 rounded-full p-2 transition-colors hover:bg-[#2a2a2a]"
                aria-label="Close"
              >
                <X className="h-5 w-5 text-gray-400 sm:h-6 sm:w-6" />
              </button>
            </Dialog.Close>
          </div>

          {/* Tab Navigation */}
          <div className="kaleido-scrollbar flex shrink-0 overflow-x-auto border-b border-[#00ff99]/10">
            <button
              onClick={() => setActiveTab("active")}
              className={`min-w-[7rem] flex-1 px-3 py-3 text-xs font-medium transition-colors sm:min-w-0 sm:px-6 sm:text-sm ${
                activeTab === "active"
                  ? "text-white border-b-2 border-[#00ff99]"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Active Orders
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`min-w-[7rem] flex-1 px-3 py-3 text-xs font-medium transition-colors sm:min-w-0 sm:px-6 sm:text-sm ${
                activeTab === "history"
                  ? "text-white border-b-2 border-[#00ff99]"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Order History
            </button>
            <button
              onClick={() => setActiveTab("transactions")}
              className={`min-w-[7rem] flex-1 px-3 py-3 text-xs font-medium transition-colors sm:min-w-0 sm:px-6 sm:text-sm ${
                activeTab === "transactions"
                  ? "text-white border-b-2 border-[#00ff99]"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Transaction History
            </button>
          </div>

          {/* Content */}
          <div className="kaleido-scrollbar min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
            {isLoading ? (
              <div className="flex h-32 items-center justify-center gap-3 text-center">
                <Spinner size={"3"} />
                <p className="text-gray-500">Fetching my orders...</p>
              </div>
            ) : (
              <div>
                {formattedOrders.length > 0 ? (
                  <div>
                    {activeTab === "active" && (
                      <div className="space-y-6">
                        {/* Orders Details - Only show Open Orders and Create Order */}
                        <div className="w-full bg-transparent px-0 py-3 md:min-h-[70vh] md:px-8 md:py-6">
                          <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:gap-6">
                            {/* Orders column */}
                            <div className="flex w-full flex-col gap-6 md:w-3/4">
                              <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/20 px-2 py-4 shadow-lg backdrop-blur-sm md:px-6">
                                <OrdersDetails orderSample={formattedOrders} />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Pending Repayments */}
                        <div className="w-full rounded-lg p-0 sm:p-4">
                          <PendingRepayments />
                        </div>
                      </div>
                    )}

                    {activeTab === "history" && (
                      <div className="w-full bg-transparent px-0 py-3 md:min-h-[70vh] md:px-8 md:py-6">
                        <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:gap-6">
                          {/* Orders column */}
                          <div className="flex w-full flex-col gap-6 md:w-3/4">
                            <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/20 px-2 py-4 shadow-lg backdrop-blur-sm md:px-6">
                              <OrdersDetails orderSample={formattedOrders} />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === "transactions" && (
                      <div className="w-full rounded-lg p-0 sm:p-4">
                        <TransactionHistory />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="[&_br]:hidden [&_h3]:!text-5xl [&_p]:!text-base sm:[&_br]:block sm:[&_h3]:!text-[70px] sm:[&_p]:!text-3xl">
                    <OhNo onCreateOrder={onCreateOrder} />
                  </div>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
