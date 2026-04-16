import { useEffect, useState } from "react"
import Image from "next/image"
import { AssetSelectorProps } from "@/constants/types"
import { getEthBalance } from "@/constants/utils/getEthBalance"
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth"
import { tokenData as defaultTokenData } from "@/constants/utils/tokenData"
import { getUsdcBalance, getUsdRBalance, getKfUSDBalance, getUSDTBalance } from "@/constants/utils/getUsdcBalance"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { formatBalance } from "@/utils/formatBalance"

const AssetSelector: React.FC<AssetSelectorProps> = ({
  onTokenSelect,
  onAssetValueChange,
  assetValue,
  userAddress,
  actionType,
}) => {
  const { etherPrice, usdcPrice, AVA, AVA2, AVA3 } = useGetValueAndHealth()
  const [selectedToken, setSelectedToken] = useState(defaultTokenData[0])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [walletBalance, setWalletBalance] = useState("0")
  const [availableBal, setAvailableBalance] = useState("")
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id

  // console.log("Selected Token:", selectedToken)

  // Fetch wallet balance based on the selected token
  // This effect sets the wallet balance on token change
  useEffect(() => {
    const fetchBalance = async () => {
      if (!userAddress) return

      let balance: any = "0"
      if (selectedToken.token === "ETH") {
        const bal = await getEthBalance(userAddress, chainId)
        balance = Number(bal).toFixed(7)
      } else if (selectedToken.token === "USDC") {
        balance = await getUsdcBalance(userAddress, chainId)
      } else if (selectedToken.token === "USDR") {
        balance = await getUsdRBalance(userAddress, chainId)
      } else if (selectedToken.token === "kfUSD") {
        balance = await getKfUSDBalance(userAddress, chainId)
      } else if (selectedToken.token === "USDT") {
        balance = await getUSDTBalance(userAddress, chainId)
      }

      setWalletBalance(Number(balance).toFixed(3) || "0")
    }

    fetchBalance()
  }, [selectedToken, userAddress, chainId])

  // This effect updates the deposited (available) balance when it becomes available
  useEffect(() => {
    if (selectedToken.token === "ETH") {
      setAvailableBalance(AVA)
    } else if (selectedToken.token === "USDC") {
      setAvailableBalance(AVA2)
      } else if (selectedToken.token === "USDR") {
      setAvailableBalance(AVA3)
    } else if (selectedToken.token === "kfUSD") {
      setAvailableBalance("0") // Default for now
    } else if (selectedToken.token === "USDT") {
      setAvailableBalance("0") // Default for now
    }
  }, [AVA, AVA2, AVA3, selectedToken.token])

  // Handle token selection from dropdown
  const handleTokenSelect = (token: string) => {
    const selected = defaultTokenData.find((item) => item.token === token)
    if (selected) {
      setSelectedToken(selected)
      const tokenPrice =
        selected.token === "ETH"
          ? etherPrice
          : selected.token === "USDR"
            ? usdcPrice
            : selected.token === "USDC"
              ? usdcPrice
              : selected.token === "kfUSD"
                ? "1" // Stable
                : selected.token === "USDT"
                  ? "1" // Stable
                  : 0
      onTokenSelect(selected.token, tokenPrice)
    }
    setIsDropdownOpen(false) // Close dropdown after selection
  }

  // Toggle dropdown visibility
  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen)
  }

  // Handle asset value input change and notify parent component
  const handleAssetValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    const regex = /^\d*\.?\d{0,8}$/ // Allow up to 5 decimal places
    if (regex.test(value)) {
      onAssetValueChange(value) // Update in parent
    }
  }

  // Handle clicking the "Max" button
  const handleMaxClick = () => {
    onAssetValueChange(actionType === "withdraw" || actionType === "borrow" ? availableBal : walletBalance || "0")
  }

  // Determine the dynamic price based on the selected token
  const tokenPrice =
    selectedToken.token === "ETH"
      ? etherPrice
      : selectedToken.token === "USDR"
        ? usdcPrice
        : selectedToken.token === "USDC"
          ? usdcPrice
          : selectedToken.token === "kfUSD"
            ? "1"
            : selectedToken.token === "USDT"
              ? "1"
              : 0

  // Calculate fiat equivalent (Amount in USD)
  const fiatEquivalent = tokenPrice ? (parseFloat(assetValue) * parseFloat(tokenPrice)).toFixed(6) : "0"

  return (
    <div className="rounded-lg bg-white p-3">
      <div className="mb-3 flex items-center justify-between text-black">
        <div
          className="relative flex cursor-pointer items-center gap-3 rounded-md bg-black p-2"
          onClick={toggleDropdown}
        >
          {/* Token icon */}
          <div className="flex items-center justify-center rounded-full px-1 py-[0.5px]">
            <Image src={selectedToken.icon} alt={selectedToken.token} width={18} height={18} priority quality={100} />
          </div>

          {/* Token name */}
          <div className="text-xs text-white">
            <p>{selectedToken.token}</p>
          </div>

          {/* Chevron for dropdown */}
          <div>
            <Image
              src={"/chevronDown.svg"}
              alt="dropdown indicator"
              width={10}
              height={5}
              priority
              quality={100}
              className="text-[#A2A8B4]"
            />
          </div>

          {/* Dropdown */}
          {isDropdownOpen && (
            <div className="absolute left-0 top-full z-20 mt-2 w-[100px] rounded-md bg-black">
              {defaultTokenData.map((token) => (
                <div
                  key={token.token}
                  onClick={() => handleTokenSelect(token.token)}
                  className="flex cursor-pointer items-center gap-2 p-2 hover:bg-[#2a2a2a]"
                >
                  <Image src={token.icon} alt={token.token} width={14} height={14} priority quality={100} />
                  <p className="text-xs text-white">{token.token}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Asset value input with Max button */}
        <div className="flex items-center">
          <label htmlFor="assetValue" className="sr-only">
            Enter Amount
          </label>
          <input
            id="assetValue"
            type="text"
            value={assetValue} // Use parent's state as controlled input
            onChange={handleAssetValueChange}
            className="w-28 border-b-2 border-gray-300 bg-transparent text-end focus:border-green-500 focus:outline-none"
            placeholder="Enter amount"
            inputMode="decimal"
          />
          {/* Max Button */}
          <button
            onClick={handleMaxClick}
            className="ml-2 rounded bg-gray-200 px-2 py-1 text-sm text-black hover:bg-gray-300"
          >
            Max
          </button>
        </div>
      </div>

      {/* Wallet balance display */}
      <p className="mb-2 text-xs text-gray-500">
        {actionType === "withdraw" || actionType === "borrow" ? "Available Balance: " : "Wallet Balance: "}
        {actionType === "withdraw" || actionType === "borrow"
          ? formatBalance(availableBal)
          : formatBalance(walletBalance)}{" "}
        {selectedToken.token}
      </p>

      {/* Price and Fiat Equivalent */}
      <div className="flex justify-between text-xs text-black">
        <p>{`1 ${selectedToken.token} = $${tokenPrice || "N/A"}`}</p>
        <p className="font-bold">≈ ${fiatEquivalent}</p>
      </div>
    </div>
  )
}

export default AssetSelector
