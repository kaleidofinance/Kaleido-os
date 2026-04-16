"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"

// Import all original create order components
import { DateInputField } from "@/components/createOrder/DateInputField"
import { Btn } from "@/components/shared/Btn"
import AssetSelector from "@/components/shared/AssetSelector"
import { Slider } from "@radix-ui/themes"
import Image from "next/image"
import useCreateLoanListing from "@/hooks/useCreateLoanListing"
import useCreateLendingRequest from "@/hooks/useCreateLendingRequest"
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth"

interface CreateOrderModalProps {
  isOpen: boolean
  onClose: () => void
  initialToken?: string
}

export default function CreateOrderModal({ isOpen, onClose, initialToken = "ETH" }: CreateOrderModalProps) {
  const [percentage, setPercentage] = useState(0)
  const [selectedToken, setSelectedToken] = useState(initialToken)

  useEffect(() => {
    if (initialToken) {
      setSelectedToken(initialToken)
    }
  }, [initialToken, isOpen])
  const [fiatAmount, setFiatAmount] = useState(0) // Fiat amount based on token price
  const [tokenPrice, setTokenPrice] = useState(0) // Initial price of the selected token
  const [assetValue, setAssetValue] = useState("0.00") // Asset value
  const [range, setRange] = useState([0, 0]) // Volume slider range
  const [rangeInTokenVal, setRangeInTokenVal] = useState([0, 0])
  const [userAddress, setUserAddress] = useState<string | null>(null) // User's wallet address
  const [activeOrderType, setActiveOrderType] = useState<"lend" | "borrow">("lend")
  const router = useRouter()

  const { etherPrice, usdcPrice, AVA, AVA2 } = useGetValueAndHealth() // Fetch token prices from custom hook

  const [showLendTooltip, setShowLendTooltip] = useState(false)
  const [showBorrowTooltip, setShowBorrowTooltip] = useState(false)
  const [dateValue, setDateValue] = useState<string>("")

  const activeAccount = useActiveAccount()
  const address = activeAccount?.address

  const createLoanOrder = useCreateLoanListing()
  const createBorrowOrder = useCreateLendingRequest()

  useEffect(() => {
    if (activeAccount && address) {
      setUserAddress(address)
    } else {
      setUserAddress(null)
    }
  }, [address, activeAccount])

  useEffect(() => {
    // Handle token selection and update fiat amount based on token price
    let price = 0
    switch (selectedToken) {
      case "ETH":
        price = etherPrice
        break
      case "USDC":
        price = usdcPrice
        break
      case "USDR":
        price = usdcPrice
        break
      default:
        price = 0 // Default price if no token is selected
    }

    // Update the fiat amount and range whenever token or asset value changes
    const updatedFiatAmount = parseFloat(assetValue) * price
    setFiatAmount(updatedFiatAmount) // Update fiat amount when a token is selected
    const updatedTokenAmount = parseFloat(assetValue)
    setRangeInTokenVal([0, updatedTokenAmount]) // Set range in token values
    setRange([0, updatedFiatAmount]) // Set range in fiat
  }, [selectedToken, assetValue, etherPrice, usdcPrice])

  // Increment and decrement functions for percentage
  const handleIncrement = () => {
    if (percentage < 100) setPercentage(percentage + 1)
  }

  const handleDecrement = () => {
    if (percentage > 0) setPercentage(percentage - 1)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value
    const regex = /^\d*\.?\d{0,3}$/

    if (regex.test(value)) {
      const numericValue = parseFloat(value)
      if (!isNaN(numericValue) && numericValue >= 0 && numericValue <= 100) {
        setPercentage(numericValue)
      }
    }
  }

  // Handle token selection and update fiat amount based on token price
  const handleTokenSelect = (token: string) => {
    setSelectedToken(token)

    let price = 0
    switch (token) {
      case "ETH":
        price = etherPrice
        break
      case "USDC":
        price = usdcPrice
        break
      case "USDR":
        price = usdcPrice
        break
      default:
        price = 0 // Default price if no token is selected
    }

    setTokenPrice(price)
    const updatedFiatAmount = parseFloat(assetValue) * price
    setFiatAmount(updatedFiatAmount) // Update fiat amount when a token is selected
    const updatedTokenAmount = parseFloat(assetValue)
    setRangeInTokenVal([0, updatedTokenAmount]) // Set range in token values
    setRange([0, updatedFiatAmount]) // Set range in fiat
  }

  // Handle asset value change from AssetSelector
  const handleAssetValueChange = (value: string) => {
    setAssetValue(value)
    const updatedFiatAmount = parseFloat(value) * tokenPrice
    setFiatAmount(updatedFiatAmount) // Recalculate fiat amount based on new asset value
    const updatedTokenAmount = parseFloat(value)
    setRangeInTokenVal([0, updatedTokenAmount]) // Set range in token values
    setRange([0, updatedFiatAmount]) // Set range in fiat
  }

  // Handle slider change
  const handleSliderChange = (value: number[]) => {
    setRange(value)

    // Prevent division by zero or invalid tokenPrice
    if (!tokenPrice || isNaN(tokenPrice) || tokenPrice <= 0) {
      return
    }

    const rangeToken = value.map((v) => v / tokenPrice) // Convert fiat to token value
    setRangeInTokenVal(rangeToken) // Update range in tokens
  }

  const handleCancel = () => {
    onClose()
  }

  const handleCreateOrder = () => {
    // Check for $10 minimum value
    if (fiatAmount < 10) {
      toast.warning("The minimum order amount is $10.", { duration: 1000 })
      return
    }

    if (!dateValue) {
      toast.warning("Please pick a valid return date for the order!", { duration: 1000 })
      return
    }
    if (activeOrderType === "lend") {
      const dateInSeconds = Math.floor(new Date(dateValue).getTime() / 1000)
      createLoanOrder(
        assetValue,
        rangeInTokenVal[0],
        rangeInTokenVal[1],
        dateInSeconds,
        percentage,
        selectedToken,
      )
      onClose() // Close modal after successful creation
    } else if (activeOrderType === "borrow") {
      const dateInSeconds = Math.floor(new Date(dateValue).getTime() / 1000)
      createBorrowOrder(assetValue, percentage, dateInSeconds, selectedToken)
      onClose() // Close modal after successful creation
    }
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/90 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg max-h-[90vh] -translate-x-1/2 -translate-y-1/2 bg-black/95 border-2 border-green-500/30 rounded-lg overflow-hidden shadow-2xl shadow-green-500/20">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-green-500/20">
            <div>
              <Dialog.Title className="text-2xl font-bold text-white">
                Create Order
              </Dialog.Title>
              <p className="text-gray-400 mt-1">
                Create a new lending pool or borrowing request
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

          {/* Content */}
          <div className="p-4 overflow-y-auto max-h-[calc(90vh-140px)]">
            <div className="u-class-shadow mt-2 rounded-md bg-black/50 p-3 border border-green-500/20">
              <p className="pl-2 text-base text-white mb-3">Order Configuration</p>

              {/* Order Type Selection */}
              <div className="my-3 px-1">
                <div className="flex w-full gap-4">
                  {/* Lend Button with Tooltip */}
                  <div
                    className="relative w-1/2"
                    onMouseEnter={() => setShowLendTooltip(true)}
                    onMouseLeave={() => setShowLendTooltip(false)}
                    onClick={() => setActiveOrderType("lend")}
                  >
                    <Btn
                      text={"Lend"}
                      css={`text-black/80 ${
                        activeOrderType === "lend" ? "bg-[#FF4D00]" : "bg-[#FF4D00]"
                      } text-xl py-2 px-4 w-full rounded flex items-center justify-center`}
                    />
                    {/* Tooltip for Lend Button */}
                    {showLendTooltip && (
                      <div className="absolute bottom-full mb-2 w-64 rounded-lg bg-[#00dd81] p-2 text-xs text-white z-10">
                        Lenders create lending pools that borrowers can borrow from.
                      </div>
                    )}
                  </div>

                  {/* Borrow Button with Tooltip */}
                  <div
                    className="relative w-1/2"
                    onMouseEnter={() => setShowBorrowTooltip(true)}
                    onMouseLeave={() => setShowBorrowTooltip(false)}
                    onClick={() => setActiveOrderType("borrow")}
                  >
                    <Btn
                      text={"Borrow"}
                      css={`text-black ${
                        activeOrderType === "borrow" ? "bg-[#FF4D00]" : "bg-[#FF4D00]"
                      } text-xl py-2 px-4 w-full rounded flex items-center justify-center`}
                    />
                    {/* Tooltip for Borrow Button */}
                    {showBorrowTooltip && (
                      <div className="absolute bottom-full mb-2 w-64 rounded-lg bg-[#23c378] p-2 text-xs text-white z-10">
                        Borrowers create borrow orders that lenders can service.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Asset Selector */}
              <AssetSelector
                onTokenSelect={handleTokenSelect}
                onAssetValueChange={handleAssetValueChange}
                assetValue={assetValue}
                userAddress={userAddress}
                actionType={activeOrderType}
              />

              {/* Interest Rate Section */}
              <div className="px-1">
                <div className="mt-3 rounded-[40px] bg-white px-3 py-4">
                  <div className="flex items-center justify-between">
                    <div className="text-[14.6px] font-medium">
                      <p className="text-[#636363]">
                        Order Value
                        <span className="ml-3 text-black/30">
                          .<span className="ml-2">Interest Value</span>
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <p className="text-[14.6px] text-black">{selectedToken}</p>
                      <Image src={"/chevron.svg"} alt="token" width={6} height={11} priority quality={100} className="" />
                    </div>
                  </div>

                  <div className="mt-2">
                    {/* Fiat amount calculation */}
                    <p className="text-[32px] font-bold text-black sm:text-[40px]">
                      ${fiatAmount.toFixed(2)} {/* Calculated fiat amount */}
                      <span className="ml-2 text-[12px] font-medium text-black/30">
                        +${(fiatAmount * (percentage / 100)).toFixed(2)} {/* Calculated interest */}
                      </span>
                    </p>
                  </div>

                  <div className="mt-2 flex w-full items-center justify-center gap-2">
                    <button
                      onClick={handleDecrement}
                      className="flex items-center justify-center rounded-full bg-[#A2A8B4] px-4 py-2 sm:px-[25px] sm:py-4"
                    >
                      <p className="text-3xl sm:text-4xl">-</p>
                    </button>

                    <div className="relative">
                      <input
                        type="number"
                        value={percentage}
                        onChange={handleInputChange}
                        className="w-[120px] rounded-2xl bg-[#23c378]/80 p-2 text-center text-[20px] font-medium text-black sm:w-[150px] sm:p-4 sm:text-[27.5px]"
                        min={0}
                        max={100}
                        step={0.001}
                        placeholder="0.00"
                      />
                      <span className="absolute right-2 top-3 text-[20px] font-medium text-black sm:right-3.5 sm:top-4 sm:text-[27.5px]">
                        %
                      </span>
                    </div>

                    <button
                      onClick={handleIncrement}
                      className="flex items-center justify-center rounded-full bg-[#A2A8B4] px-4 py-2 sm:px-[25px] sm:py-4"
                    >
                      <p className="text-3xl sm:text-4xl">+</p>
                    </button>
                  </div>
                </div>
              </div>

              {/* Calendar / DateInputField */}
              <div className="px-1">
                <DateInputField dateValue={dateValue} setDateValue={setDateValue} />
              </div>

              {/* Volume Slider Section - Below the Calendar */}
              {activeOrderType === "lend" && (
                <div className="px-1">
                  <div className="mt-3 rounded-[40px] px-3 py-4">
                    <p className="mb-2 text-lg text-white sm:text-xl">Customize Order Volume per User</p>

                    <div className="mt-3">
                      <p className="text-[14.6px] text-white">Borrow Allocation</p>

                      <div className="mt-2 w-full rounded-lg bg-[#b4ffd8]">
                        <Slider
                          value={range}
                          onValueChange={handleSliderChange}
                          className="w-full"
                          size="3"
                          color="red"
                          radius="large"
                          min={0}
                          max={fiatAmount}
                          step={1}
                        />
                      </div>

                      <div className="mt-4 flex items-center justify-between text-base">
                        <div className="w-full sm:w-[121px]">
                          <div className="w-full rounded-lg border border-[#00ff99]/30 py-2 sm:py-3">
                            <p className="pl-4 text-white">${range[0].toFixed(2)}</p> {/* Lower Limit */}
                          </div>
                          <p className="mt-1 text-center text-[10px] font-medium text-white">Lower Limit</p>
                        </div>

                        <div className="mt-[-25px] text-2xl text-white">-</div>

                        <div className="w-full sm:w-[121px]">
                          <div className="w-full rounded-lg border border-[#00ff99]/30 py-2 sm:py-3">
                            <p className="pl-4 text-white">${range[1]?.toFixed(2)}</p> {/* Upper Limit */}
                          </div>
                          <p className="mt-1 text-center text-[10px] font-medium text-white">Upper Limit</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="mb-2 mt-6 cursor-pointer px-1">
                <div onClick={handleCreateOrder}>
                  <Btn
                    text={"Create Order"}
                    css="text-black bg-[#FF4D00] text-base w-full py-2 rounded flex items-center justify-center"
                  />
                </div>
              </div>

              <div onClick={handleCancel} className="mb-3 cursor-pointer px-1">
                <Btn
                  text={"Cancel"}
                  css="text-black bg-[#a2a8b4]/80 text-base w-full py-2 rounded flex items-center justify-center"
                />
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
