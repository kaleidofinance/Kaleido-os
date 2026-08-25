"use client";
import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useActiveAccount } from "thirdweb/react";
import { useAtom } from "jotai";
import useServiceRequest from "@/hooks/useServiceRequest";
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth";
import useCloseListingAd from "@/hooks/useCloseListingAd";
import useCloseRequest from "@/hooks/useCloseRequest";
import {
  selectedTokenAtom,
  selectedOrderAtom,
  activeTableAtom,
  isTokenDropdownOpenAtom,
  orderstatusopenAtom,
  currentPageAtom,
  filterbyAmountAtom,
  filterbyUserOrderAtom,
  filterbyDurationAtom,
  loadingBorrowAtom,
  interestAtom,
  selectedVolumeRangesAtom,
  filterByOwnerAtom,
  filterByOverdue,
} from "@/constants/atom";
import { useEnhancedCardData } from "@/components/market/EnhancedCardlayout";
import { Ordertype } from "@/constants/types/index";
import { declaredSymbol } from "@/constants/registry";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";
import { READ_ONLY_CHAIN_ID } from "@/config/provider";
import { ethers } from "ethers";

export default function useDataFiltersPanel() {
  const router = useRouter();
  const activeAccount = useActiveAccount();
  const address = activeAccount?.address;

  const { etherPrice, usdcPrice } = useGetValueAndHealth();
  const { closeListingAd } = useCloseListingAd();
  const { closeRequest } = useCloseRequest();
  const serviceRequest = useServiceRequest();

  // Use the enhanced card data hook
  const enhancedData = useEnhancedCardData();

  // Global filter atoms for setters (the enhanced hook handles the getters)
  const [loadingBorrow, setLoadingBorrow] = useAtom(loadingBorrowAtom);
  const [interestRate, setInterestRate] = useAtom(interestAtom);
  const [selectedToken, setSelectedToken] = useAtom(selectedTokenAtom);
  const [selectedOrder, setSelectedOrder] = useAtom(selectedOrderAtom);
  const [activeTable, setActiveTable] = useAtom(activeTableAtom);
  const [isTokenDropdownOpen, setIsTokenDropdownOpen] = useAtom(
    isTokenDropdownOpenAtom,
  );
  const [orderstatusopen, setOrderStatusOpen] = useAtom(orderstatusopenAtom);
  const [currentPage, setCurrentPage] = useAtom(currentPageAtom);
  const [filterbyAmount, setFilterByAmount] = useAtom(filterbyAmountAtom);
  const [filterbyUserOrder, setFilterByUserOrder] = useAtom(
    filterbyUserOrderAtom,
  );
  const [filterbyDuration, setFilterByDuration] = useAtom(filterbyDurationAtom);
  const [selectedVolumeRanges, setSelectedVolumeRanges] = useAtom(
    selectedVolumeRangesAtom,
  );
  const [filterByOwner, setFilterByOwner] = useAtom(filterByOwnerAtom);
  const [filterbyOverdue, setFilterByOverdue] = useAtom(filterByOverdue);

  // Backward compatibility - create paginated data structure that matches old hook
  const paginatedBorrowData = useMemo(() => {
    const borrowData = enhancedData.borrowData;
    return {
      data: borrowData.paginatedData.paginatedData || [],
      totalItems: borrowData.paginatedData.filteredTotal || 0,
      totalPages: borrowData.paginatedData.totalPages || 0,
      hasNext: borrowData.paginatedData.hasNextPage || false,
      hasPrev: borrowData.paginatedData.hasPrevPage || false,
      currentPage: borrowData.paginatedData.currentPage || 1,
    };
  }, [enhancedData.borrowData]);

  const paginatedLendData = useMemo(() => {
    const lendData = enhancedData.lendData;
    return {
      data: lendData.paginatedData.paginatedData || [],
      totalItems: lendData.paginatedData.filteredTotal || 0,
      totalPages: lendData.paginatedData.totalPages || 0,
      hasNext: lendData.paginatedData.hasNextPage || false,
      hasPrev: lendData.paginatedData.hasPrevPage || false,
      currentPage: lendData.paginatedData.currentPage || 1,
    };
  }, [enhancedData.lendData]);

  // Handlers
  const handleTableChange = useCallback(
    (table: typeof activeTable) => {
      setActiveTable(table);
      setCurrentPage(1); // Reset to first page when switching tables
    },
    [setActiveTable, setCurrentPage],
  );

  const handleToggleDropdown = useCallback(() => {
    setIsTokenDropdownOpen((prev) => !prev);
  }, [setIsTokenDropdownOpen]);

  const setOrderToggleDropDown = useCallback(() => {
    setOrderStatusOpen((prev) => !prev);
  }, [setOrderStatusOpen]);

  const setOrderSelection = useCallback(
    (status: Ordertype) => {
      setSelectedOrder(status);
      setOrderStatusOpen(false);
    },
    [setSelectedOrder, setOrderStatusOpen],
  );

  const handleTokenSelect = useCallback(
    (token: string) => {
      setSelectedToken(token);
      setIsTokenDropdownOpen(false);
    },
    [setSelectedToken, setIsTokenDropdownOpen],
  );

  const handleBorrowAllocation = useCallback(
    (data: any) => {
      const decimal = getTokenDecimals(READ_ONLY_CHAIN_ID, data.tokenAddress);
      const maxAmount = ethers.formatUnits(
        data.maxAmount || data.max_amount,
        decimal,
      );
      const minAmount = ethers.formatUnits(
        data.minAmount || data.min_amount,
        decimal,
      );
      /* Chain-scoped, like the decimals above. This was
         `tokenImageMap[addr]?.label` against a table of Abstract literals, which
         after the address cutover matched nothing on any deployed chain and put
         the literal string `tokenType=undefined` in the query. */
      const tokenType = declaredSymbol(READ_ONLY_CHAIN_ID, data.tokenAddress);
      const queryString = `?listingId=${data.listingId}&maxAmount=${maxAmount}&minAmount=${minAmount}&tokenType=${tokenType ?? ""}`;
      router.push(`/borrow-allocation${queryString}`);
    },
    [router],
  );

  const updateSliderValue = useCallback(
    (newValue: number[]) => {
      const current = newValue[0];
      setInterestRate(current);
    },
    [setInterestRate],
  );

  const toggleVolumeFilter = useCallback(
    (range: { min: number; max: number }) => {
      setSelectedVolumeRanges((prev) => {
        const exists = prev.some(
          (r) => r.min === range.min && r.max === range.max,
        );
        if (exists) {
          return prev.filter(
            (r) => !(r.min === range.min && r.max === range.max),
          );
        } else {
          return [...prev, range];
        }
      });
    },
    [setSelectedVolumeRanges],
  );

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSelectedToken("All Tokens");
    setSelectedOrder("All Orders");
    setInterestRate(100);
    setSelectedVolumeRanges([]);
    setFilterByOwner(false);
    setFilterByOverdue(false);
    setCurrentPage(1);
  }, [
    setSelectedToken,
    setSelectedOrder,
    setInterestRate,
    setSelectedVolumeRanges,
    setFilterByOwner,
    setFilterByOverdue,
    setCurrentPage,
  ]);

  // Refresh function that calls the enhanced data refresh
  const refreshListings = useCallback(() => {
    enhancedData.refresh();
  }, [enhancedData.refresh]);

  return {
    // Data - using enhanced data
    allListings: enhancedData.rawBorrowData.listings || [],
    openListings: enhancedData.rawBorrowData.listings || [],
    myListings:
      enhancedData.rawBorrowData.listings?.filter(
        (listing) => listing.sender?.toLowerCase() === address?.toLowerCase(),
      ) || [],
    /*
     * The lender side of a live loan, which cannot be found in `myListings`:
     * on-chain a listing is only ever OPEN or CLOSED (ListingStatus in
     * model/Protocol.sol), so filtering the user's listings for a funded one
     * always returns nothing. The loan is a *request* row with `lender` set —
     * written both by funding a request directly and by a borrower taking one
     * of the user's listings, since requestLoanFromListing sets
     * newRequest.lender to the listing's author.
     *
     * The lend cursor fetches status OPEN,SERVICED, and an OPEN request has no
     * lender yet, so everything this returns is a loan the user is funding.
     */
    myFundedLoans:
      enhancedData.rawLendData.requests?.filter(
        (request) => request.lender?.toLowerCase() === address?.toLowerCase(),
      ) || [],
    filteredBorrowData: enhancedData.borrowData.filteredData || [],
    filteredLendData: enhancedData.lendData.filteredData || [],
    paginatedBorrowData,
    paginatedLendData,

    // Cursor-load status for the whole book, so a page that renders the loaded
    // set can show a true count and offer "Load more" once the book runs past
    // the first fetch (limit 100). `total` is the server's real count; `hasMore`
    // is true while rows remain unfetched; `isLoadingMore` guards the button.
    hasMoreBorrow: enhancedData.borrowData.hasMore,
    hasMoreLend: enhancedData.lendData.hasMore,
    totalBorrow: enhancedData.borrowData.total,
    totalLend: enhancedData.lendData.total,
    isLoadingMoreBorrow: enhancedData.borrowData.isLoadingMore,
    isLoadingMoreLend: enhancedData.lendData.isLoadingMore,

    // States - using enhanced data where possible, otherwise atom states
    etherPrice,
    usdcPrice,
    address,
    activeTable: enhancedData.activeTable,
    selectedToken: enhancedData.filterOptions.token,
    selectedOrder: enhancedData.filterOptions.order,
    isTokenDropdownOpen,
    orderstatusopen,
    loadingBorrow: enhancedData.borrowData.loading,
    lendLoading: enhancedData.lendData.loading,
    currentPage: enhancedData.currentPage,
    filterbyAmount,
    filterbyUserOrder,
    filterbyDuration,
    interestRate: enhancedData.filterOptions.interestRate,
    selectedVolumeRanges: enhancedData.filterOptions.volumeRanges,
    filterByOwner: enhancedData.filterOptions.ownerFilter,
    // filterbyOverdue: enhancedData.filterOptions.overdueFilter,

    // Actions - mix of enhanced data and local setters
    setActiveTable,
    setSelectedToken,
    setSelectedOrder,
    setOrderStatusOpen,
    setCurrentPage: enhancedData.setCurrentPage,
    setFilterByAmount,
    setFilterByUserOrder,
    setFilterByDuration,
    setInterestRate,
    setFilterByOwner,
    setFilterByOverdue,
    handleToggleDropdown,
    setOrderToggleDropDown,
    setOrderSelection,
    handleTokenSelect,
    handleTableChange,
    handleBorrowAllocation,
    updateSliderValue,
    toggleVolumeFilter,
    clearAllFilters,
    refreshListings,

    // Services - use service hooks
    closeListingAd,
    closeRequest,
    serviceRequest,

    // Legacy compatibility
    newfilteredlendData: enhancedData.lendData.filteredData || [],

    // Enhanced data methods (new functionality)
    loadMore: enhancedData.loadMore,
    goToPage: enhancedData.goToPage,
    nextPage: enhancedData.nextPage,
    prevPage: enhancedData.prevPage,
    stats: enhancedData.stats,
  };
}
