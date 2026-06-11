import Image from "next/image"
import { useState, useEffect } from "react"
import { useAtom } from "jotai"
import { Search, X, Filter, ChevronDown, Check, SlidersHorizontal } from "lucide-react"
import * as Dialog from "@radix-ui/react-dialog"
import {
  selectedTokenAtom,
  selectedOrderAtom,
  activeTableAtom,
  interestAtom,
  selectedVolumeRangesAtom,
  filterByOwnerAtom,
  searchByIdAtom,
  filtervolumebyOrder,
} from "@/constants/atom"
import { useEnhancedCardData } from "@/components/market/EnhancedCardlayout"
import { tokenImageMap } from "@/constants/utils/tokenImageMap"
import { orderTypesArray, statusLabels } from "@/constants/types/orders"
import SliderControl from "../ui/slider"
import { getMinimumInterest } from "@/constants/utils/minimumInterest"
import { AMOUNT_FILTERS } from "@/constants/utils/AmountFilter"
import { Ordertype } from "@/constants/types"

export const DataFiltersPanel = () => {
  // Use atoms directly for filter state management
  const [selectedToken, setSelectedToken] = useAtom(selectedTokenAtom)
  const [selectedOrder, setSelectedOrder] = useAtom(selectedOrderAtom)
  const [activeTable] = useAtom(activeTableAtom)
  const [interestRate] = useAtom(interestAtom)
  const [selectedVolumeRanges, setSelectedVolumeRanges] = useAtom(selectedVolumeRangesAtom)
  const [filterByOwner, setFilterByOwner] = useAtom(filterByOwnerAtom)
  const [searchById, setSearchById] = useAtom(searchByIdAtom)
  const [filterbyVolumeOrder, setFilterByVolumeOrder] = useAtom(filtervolumebyOrder)
  const [, setInterestRate] = useAtom(interestAtom)

  // Local state for debounced search input
  const [localSearchValue, setLocalSearchValue] = useState(searchById)
  
  // Modal states
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false)
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false)
  const [isInterestModalOpen, setIsInterestModalOpen] = useState(false)
  const [isVolumeModalOpen, setIsVolumeModalOpen] = useState(false)
  const [isAdvancedModalOpen, setIsAdvancedModalOpen] = useState(false)

  // Get filtered data from the enhanced hook
  const { borrowData, lendData } = useEnhancedCardData()

  // Get active data based on current table
  const activeData = activeTable === "lend" ? lendData.filteredData : borrowData.filteredData
  const minInterest = getMinimumInterest(Array.isArray(activeData) ? activeData : [])

  // Update local value when atom changes
  useEffect(() => {
    setLocalSearchValue(searchById)
  }, [searchById])

  // Debounced search - update atom after user stops typing
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setSearchById(localSearchValue)
    }, 300)
    return () => clearTimeout(timeoutId)
  }, [localSearchValue, setSearchById])

  // Helper function to toggle volume filters
  const toggleVolumeFilter = (range: { min: number; max: number }) => {
    const isSelected = selectedVolumeRanges.some(
      (selectedRange) => selectedRange.min === range.min && selectedRange.max === range.max,
    )
    if (isSelected) {
      // Remove the range
      setSelectedVolumeRanges(
        selectedVolumeRanges.filter(
          (selectedRange) => !(selectedRange.min === range.min && selectedRange.max === range.max),
        ),
      )
    } else {
      // Add the range
      setSelectedVolumeRanges([...selectedVolumeRanges, range])
    }
  }

  // Clear search function
  const handleClearSearch = () => {
    setLocalSearchValue("")
    setSearchById("")
  }

  // Handle volume order change
  const handleFilterbyvolumeOrder = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilterByVolumeOrder(e.target.value)
  }

  // Helper functions for modal system
  const getActiveFilterCount = () => {
    let count = 0
    if (selectedToken !== "All Tokens") count++
    if (selectedOrder !== "All Orders") count++
    if (interestRate < 100) count++
    if (selectedVolumeRanges.length > 0) count++
    if (filterByOwner) count++
    return count
  }

  const getSelectedTokenLabel = () => {
    if (selectedToken === "All Tokens") return "All Tokens"
    const token = tokenImageMap[selectedToken]
    return token ? token.label : "Unknown Token"
  }

  const getSelectedTokenImage = () => {
    if (selectedToken === "All Tokens") return null
    const token = tokenImageMap[selectedToken]
    return token ? token.image : null
  }

  const clearAllFilters = () => {
    setSelectedToken("All Tokens")
    setSelectedOrder("All Orders")
    setInterestRate(100)
    setSelectedVolumeRanges([])
    setFilterByOwner(false)
    setFilterByVolumeOrder("Highest")
  }

  return (
    <div className="w-full mt-4" data-tour="filter-card">
      {/* Compact Filter Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Filter className="h-6 w-6 text-green-400" />
            <h2 className="text-2xl font-bold text-white">Filters</h2>
            {getActiveFilterCount() > 0 && (
              <div className="rounded-full bg-green-500 px-3 py-1 text-sm font-semibold text-black">
                {getActiveFilterCount()} Active
              </div>
            )}
          </div>
          {getActiveFilterCount() > 0 && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-2 rounded-lg bg-[#2a2a2a] px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-[#2a2a2a] hover:text-white"
            >
              <X className="h-4 w-4" />
              Clear All
            </button>
          )}
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap gap-3">
          {/* Token Filter Chip */}
          <button
            onClick={() => setIsTokenModalOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm font-medium text-green-400 transition-all hover:bg-green-500/20 hover:border-green-500/50"
          >
            {getSelectedTokenImage() && (
              <img src={getSelectedTokenImage()!} alt={getSelectedTokenLabel()} className="h-4 w-4 rounded-full" />
            )}
            {getSelectedTokenLabel()}
            <ChevronDown className="h-3 w-3" />
          </button>

          {/* Status Filter Chip */}
          <button
            onClick={() => setIsStatusModalOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-400 transition-all hover:bg-blue-500/20 hover:border-blue-500/50"
          >
            {statusLabels[selectedOrder]}
            <ChevronDown className="h-3 w-3" />
          </button>

          {/* Interest Rate Filter Chip */}
          <button
            onClick={() => setIsInterestModalOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm font-medium text-purple-400 transition-all hover:bg-purple-500/20 hover:border-purple-500/50"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Up to {interestRate}%
            <ChevronDown className="h-3 w-3" />
          </button>

          {/* Volume Filter Chip */}
          <button
            onClick={() => setIsVolumeModalOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm font-medium text-yellow-400 transition-all hover:bg-yellow-500/20 hover:border-yellow-500/50"
          >
            {selectedVolumeRanges.length > 0 ? `${selectedVolumeRanges.length} ranges` : 'All volumes'}
            <ChevronDown className="h-3 w-3" />
          </button>

          {/* Advanced Options Chip */}
          <button
            onClick={() => setIsAdvancedModalOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-gray-500/30 bg-[#2a2a2a]/10 px-4 py-2 text-sm font-medium text-gray-400 transition-all hover:bg-[#2a2a2a]/20 hover:border-gray-500/50"
          >
            <Filter className="h-4 w-4" />
            Advanced
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Token Selection Modal */}
      <Dialog.Root open={isTokenModalOpen} onOpenChange={setIsTokenModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 bg-black/95 rounded-xl border border-green-500/60 shadow-2xl shadow-green-500/40">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="text-xl font-bold text-white">Select Token</Dialog.Title>
                <Dialog.Close asChild>
                  <button className="rounded-full p-2 hover:bg-[#2a2a2a] transition-colors" aria-label="Close">
                    <X className="h-5 w-5 text-gray-400" />
                  </button>
                </Dialog.Close>
              </div>
              
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {/* All Tokens Option */}
                <button
                  onClick={() => {
                    setSelectedToken("All Tokens")
                    setIsTokenModalOpen(false)
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-all ${
                    selectedToken === "All Tokens"
                      ? "bg-[#2a2a2a] text-white border border-green-500/80"
                      : "hover:bg-[#2a2a2a] text-white"
                  }`}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2a2a2a] text-xs font-bold">
                    ALL
                  </div>
                  <span className="font-medium">All Tokens</span>
                  {selectedToken === "All Tokens" && <Check className="h-5 w-5 ml-auto" />}
                </button>

                {/* Individual Tokens */}
                {Object.entries(tokenImageMap).map(([tokenAddress, token]) => (
                  <button
                    key={tokenAddress}
                    onClick={() => {
                      setSelectedToken(tokenAddress)
                      setIsTokenModalOpen(false)
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-all ${
                      selectedToken === tokenAddress
                        ? "bg-[#2a2a2a] text-white border border-green-500/80"
                        : "hover:bg-[#2a2a2a] text-white"
                    }`}
                  >
                    <img src={token.image} alt={token.label} className="h-8 w-8 rounded-full" />
                    <span className="font-medium">{token.label}</span>
                    {selectedToken === tokenAddress && <Check className="h-5 w-5 ml-auto" />}
                  </button>
                ))}
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Status Selection Modal */}
      <Dialog.Root open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 bg-black/95 rounded-xl border border-green-500/60 shadow-2xl shadow-green-500/40">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="text-xl font-bold text-white">Select Status</Dialog.Title>
                <Dialog.Close asChild>
                  <button className="rounded-full p-2 hover:bg-[#2a2a2a] transition-colors" aria-label="Close">
                    <X className="h-5 w-5 text-gray-400" />
                  </button>
                </Dialog.Close>
              </div>
              
              <div className="space-y-2">
                {orderTypesArray.map((status) => (
                  <button
                    key={status}
                    onClick={() => {
                      setSelectedOrder(status as Ordertype)
                      setIsStatusModalOpen(false)
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-4 py-3 text-left transition-all ${
                      selectedOrder === status
                        ? "bg-[#2a2a2a] text-white border border-green-500/80"
                        : "hover:bg-[#2a2a2a] text-white"
                    }`}
                  >
                    <span className="font-medium">{statusLabels[status]}</span>
                    {selectedOrder === status && <Check className="h-5 w-5" />}
                  </button>
                ))}
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Interest Rate Modal */}
      <Dialog.Root open={isInterestModalOpen} onOpenChange={setIsInterestModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 bg-black/95 rounded-xl border border-green-500/60 shadow-2xl shadow-green-500/40">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="text-xl font-bold text-white">Interest Rate</Dialog.Title>
                <Dialog.Close asChild>
                  <button className="rounded-full p-2 hover:bg-[#2a2a2a] transition-colors" aria-label="Close">
                    <X className="h-5 w-5 text-gray-400" />
                  </button>
                </Dialog.Close>
              </div>
              
              <div className="space-y-4">
                <div className="rounded-xl bg-[#2a2a2a]/50 p-4 border border-green-500/60">
                  <SliderControl min={minInterest} />
                  <div className="mt-3 flex justify-between text-sm">
                    <span className="text-gray-400">0%</span>
                    <span className="font-semibold text-white">{`${interestRate}%`}</span>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setInterestRate(25)
                      setIsInterestModalOpen(false)
                    }}
                    className="flex-1 rounded-lg bg-[#2a2a2a] px-4 py-2 text-sm text-white hover:bg-[#2a2a2a] border border-green-500/60"
                  >
                    Up to 25%
                  </button>
                  <button
                    onClick={() => {
                      setInterestRate(50)
                      setIsInterestModalOpen(false)
                    }}
                    className="flex-1 rounded-lg bg-[#2a2a2a] px-4 py-2 text-sm text-white hover:bg-[#2a2a2a] border border-green-500/60"
                  >
                    Up to 50%
                  </button>
                  <button
                    onClick={() => {
                      setInterestRate(100)
                      setIsInterestModalOpen(false)
                    }}
                    className="flex-1 rounded-lg bg-[#2a2a2a] px-4 py-2 text-sm text-white hover:bg-[#2a2a2a] border border-green-500/60"
                  >
                    All Rates
                  </button>
                </div>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Volume Selection Modal */}
      <Dialog.Root open={isVolumeModalOpen} onOpenChange={setIsVolumeModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 bg-black/95 rounded-xl border border-green-500/60 shadow-2xl shadow-green-500/40">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="text-xl font-bold text-white">Volume Ranges</Dialog.Title>
                <Dialog.Close asChild>
                  <button className="rounded-full p-2 hover:bg-[#2a2a2a] transition-colors" aria-label="Close">
                    <X className="h-5 w-5 text-gray-400" />
                  </button>
                </Dialog.Close>
              </div>
              
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {AMOUNT_FILTERS.map(({ label, min, max }) => {
                  const isChecked = selectedVolumeRanges.some((range) => range.min === min && range.max === max)
                  return (
                    <label
                      key={label}
                      className={`flex cursor-pointer select-none items-center rounded-lg px-3 py-2 transition-all ${
                        isChecked ? "bg-[#2a2a2a] border border-green-500/80" : "hover:bg-[#2a2a2a]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-600 bg-[#2a2a2a] text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/60"
                        checked={isChecked}
                        onChange={() => toggleVolumeFilter({ min, max })}
                      />
                      <span className="ml-3 text-sm text-white">{label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Advanced Options Modal */}
      <Dialog.Root open={isAdvancedModalOpen} onOpenChange={setIsAdvancedModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 bg-black/95 rounded-xl border border-green-500/60 shadow-2xl shadow-green-500/40">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="text-xl font-bold text-white">Advanced Options</Dialog.Title>
                <Dialog.Close asChild>
                  <button className="rounded-full p-2 hover:bg-[#2a2a2a] transition-colors" aria-label="Close">
                    <X className="h-5 w-5 text-gray-400" />
                  </button>
                </Dialog.Close>
              </div>
              
              <div className="space-y-4">
                {/* Owner Filter */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-300">My Orders Only</span>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={filterByOwner}
                      onChange={() => setFilterByOwner(!filterByOwner)}
                    />
                    <div className="peer h-6 w-11 rounded-full bg-[#2a2a2a] transition-colors peer-checked:bg-green-500 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300/40">
                      <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5"></div>
                    </div>
                  </label>
                </div>

                {/* Sort by Amount */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-300">Sort by Amount</label>
                  <select
                    value={filterbyVolumeOrder}
                    onChange={handleFilterbyvolumeOrder}
                    className="w-full rounded-lg border border-gray-600 bg-[#2a2a2a] px-3 py-2 text-sm text-white focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500/60"
                  >
                    <option value="Highest">Highest Amount</option>
                    <option value="Lowest">Lowest Amount</option>
                  </select>
                </div>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
