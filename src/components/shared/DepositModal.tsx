"use client"

import AssetSelector from "@/components/shared/AssetSelector"
import { Btn } from "@/components/shared/Btn"
import { kfUSD_ADDRESS, USDC_ADDRESS, USDR, USDT_ADDRESS } from "@/constants/utils/addresses"
import { getUsdcAddressByChainId } from "@/constants/utils/getUsdcBalance"
import useDepositCollateral from "@/hooks/useDepositCollateral"
import useDepositNativeColateral from "@/hooks/useDepositNativeColateral"
import useWithdrawCollateral from "@/hooks/useWithdrawCollateral"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { useState, useEffect } from "react"
import { toast } from "sonner"
import * as Dialog from "@radix-ui/react-dialog"
import { ADDRESS_1 } from "@/constants/utils/addresses"

interface DepositModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: "deposit" | "withdraw"
}

export default function DepositModal({ open, onOpenChange, action }: DepositModalProps) {
  const actionText = action === "deposit" ? "Deposit" : "Withdraw"
  const [assetValue, setAssetValue] = useState("0.00")
  const [selectedToken, setSelectedToken] = useState<string | null>("ETH")
  const [userAddress, setUserAddress] = useState<string | null>(null)
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const address = activeAccount?.address

  const depositFx = useDepositCollateral()
  const depositNative = useDepositNativeColateral()
  const withdrawTx = useWithdrawCollateral()

  useEffect(() => {
    if (activeAccount && address) {
      setUserAddress(address)
    } else {
      setUserAddress(null)
    }
  }, [address, activeAccount, activeChain?.id])

  const handleTokenSelect = (token: string, price: number) => {
    setSelectedToken(token)
  }

  const handleAssetValueChange = (value: string) => {
    setAssetValue(value)
  }

  const handleAction = async () => {
    if (!selectedToken) {
      toast.error("Please select a token.")
      return
    }

    if (parseFloat(assetValue) <= 0) {
      toast.error("Please enter a valid amount.")
      return
    }

    try {
      if (action === "deposit") {
        if (selectedToken === "ETH" && userAddress) {
          await depositNative(assetValue)
        } else if (selectedToken === "USDC" && userAddress) {
          await depositFx(assetValue, USDC_ADDRESS)
        } else if (selectedToken === "USDR" && userAddress) {
          await depositFx(assetValue, USDR)
        } else if (selectedToken === "kfUSD" && userAddress) {
          await depositFx(assetValue, kfUSD_ADDRESS)
        } else if (selectedToken === "USDT" && userAddress) {
          await depositFx(assetValue, USDT_ADDRESS)
        } else {
          toast.error("Token not supported for deposit.")
        }
      } else if (action === "withdraw") {
        if (selectedToken === "ETH" && userAddress) {
          await withdrawTx(ADDRESS_1, assetValue)
        }
        if (selectedToken === "USDC" && userAddress) {
          const usdcAddress = getUsdcAddressByChainId(activeChain?.id)
          await withdrawTx(usdcAddress, assetValue)
        } else if (selectedToken === "USDR" && userAddress) {
          await withdrawTx(USDR, assetValue)
        } else if (selectedToken === "kfUSD" && userAddress) {
          await withdrawTx(kfUSD_ADDRESS, assetValue)
        } else if (selectedToken === "USDT" && userAddress) {
          await withdrawTx(USDT_ADDRESS, assetValue)
        }
      }
      // Close modal on success
      onOpenChange(false)
      // Reset form
      setAssetValue("0.00")
    } catch (error) {
      console.error(`${actionText} error:`, error)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
    setAssetValue("0.00")
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/90 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-[427px] -translate-x-1/2 -translate-y-1/2 bg-black/95 backdrop-blur-md border border-green-500/40 rounded-lg shadow-lg p-4">
          <div className="u-class-shadow">
            <p className="pb-2 pl-2 text-base text-white">{actionText}</p>

            <AssetSelector
              onTokenSelect={handleTokenSelect}
              onAssetValueChange={handleAssetValueChange}
              assetValue={assetValue}
              userAddress={userAddress}
              actionType={action}
            />

            <div>
              <div className="my-4 cursor-pointer" onClick={handleAction}>
                <Btn
                  text={actionText}
                  css="text-black bg-[#FF4D00CC]/80 text-base w-full py-2 rounded flex items-center justify-center"
                />
              </div>
              <div className="mb-4 cursor-pointer" onClick={handleCancel}>
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

