"use client"

import AssetSelector from "@/components/shared/AssetSelector"
import { Btn } from "@/components/shared/Btn"
import PleaseConnect from "@/components/shared/PleaseConnect"
import { ADDRESS_1, USDC_ADDRESS, USDR } from "@/constants/utils/addresses"
import { getUsdcAddressByChainId } from "@/constants/utils/getUsdcBalance"
import useDepositCollateral from "@/hooks/useDepositCollateral"
import useDepositNativeColateral from "@/hooks/useDepositNativeColateral"
import useWithdrawCollateral from "@/hooks/useWithdrawCollateral"
import { Spinner } from "@radix-ui/themes"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"

export default function TransactPage({ params }: { params: { action: string } }) {
  const actionText = params.action === "deposit" ? "Deposit" : "Withdraw"
  const [assetValue, setAssetValue] = useState("0.00")
  const [selectedToken, setSelectedToken] = useState<string | null>("ETH") // To track selected token
  const [userAddress, setUserAddress] = useState<string | null>(null)
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const address = activeAccount?.address
  const [isClient, setIsClient] = useState(false)
  const router = useRouter()

  const depositFx = useDepositCollateral() // For LINK and other tokens
  const depositNative = useDepositNativeColateral() // For ETH
  const withdrawTx = useWithdrawCollateral() // Withdraw function

  useEffect(() => {
    setIsClient(true)
  }, [])

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
      if (params.action === "deposit") {
        if (selectedToken === "ETH" && userAddress) {
          await depositNative(assetValue)
        } else if (selectedToken === "USDC" && userAddress) {
          await depositFx(assetValue, USDC_ADDRESS)
        } else if (selectedToken === "USDR" && userAddress) {
          await depositFx(assetValue, USDR)
        } else {
          toast.error("Token not supported for deposit.")
        }
      } else if (params.action === "withdraw") {
        if (selectedToken === "ETH" && userAddress) {
          await withdrawTx(ADDRESS_1, assetValue)
        }
        if (selectedToken === "USDC" && userAddress) {
          const usdcAddress = getUsdcAddressByChainId(activeChain?.id)
          await withdrawTx(usdcAddress, assetValue)
        } else if (selectedToken === "USDR" && userAddress) {
          await withdrawTx(USDR, assetValue)
        } else {
          // toast.error("Token not supported for withdrawal.");
        }
      }
    } catch (error) {
      // console.error(`${actionText} error:`, error);
    }
  }

  const handleCancel = () => {
    router.push("/")
  }

  if (!isClient) {
    return (
      <div className="my-64 flex justify-center text-[#00ff88]">
        <Spinner size={"3"} />
      </div>
    )
  }


  return (
    <div className="flex h-screen items-center">
      <div className="u-class-shadow max-w-[427px] rounded-lg bg-black p-4 sm:min-w-[427px]">
        <p className="pb-2 pl-2 text-base text-white">{actionText}</p>

        <AssetSelector
          onTokenSelect={handleTokenSelect}
          onAssetValueChange={handleAssetValueChange}
          assetValue={assetValue}
          userAddress={userAddress}
          actionType={params.action}
        />

        <div>
          <div className="my-4 cursor-pointer" onClick={activeAccount ? handleAction : () => {}}>
            <Btn
              text={activeAccount ? actionText : "Connect Wallet"}
              css={`text-black bg-[#FF4D00CC]/80 text-base w-full py-2 rounded flex items-center justify-center ${!activeAccount ? 'opacity-50 cursor-not-allowed' : ''}`}
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
    </div>
  )
}
