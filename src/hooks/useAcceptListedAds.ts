"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ethers } from "ethers"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { ErrorDecoder } from "ethers-decode-error"
import { client } from "@/config/client"
import { isSupportedChain } from "@/config/chain"
import { getKaleidoContract } from "@/config/contracts"
import { SUPPORTED_CHAIN_ID } from "@/context/web3Modal"
import lendbitAbi from "@/abi/ProtocolFacet.json"

const errorDecoder = ErrorDecoder.create([lendbitAbi])

const ERROR_MESSAGES: Record<string, string> = {
  Protocol__ListingNotOpen: "This order is not available!",
  Protocol__OwnerCreatedListing: "You cannot accept your own order!",
  "0x8a051e0f": "You cannot accept your own order!",
  Protocol__InsufficientCollateral: "Insufficient collateral!",
  "0x5006c6c0": "Insufficient collateral!",
  Protocol__InvalidAmount: "Please enter a valid amount!",
  Protocol__TransferFailed: "Action failed!",
  Protocol__CannotBorrowCollateralAsset: "You cannot borrow collateral asset!",
  Protocol__DateMustBeInFuture: "Date is Invalid",
}

const useAcceptListedAds = () => {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id
  const router = useRouter()

  return useCallback(
    async (_orderId: number, _amount: string, tokenType: string) => {
      if (!activeAccount || !activeChain) {
        toast.warning("Wallet not connected")
        return
      }

      if (!isSupportedChain(chainId)) {
        toast.warning("SWITCH NETWORK")
        return
      }

      try {
        const signer = await ethers6Adapter.signer.toEthers({
          client,
          chain: activeChain,
          account: activeAccount,
        })

        if (!signer) {
          toast.error("Signer not available")
          return
        }

        const contract = getKaleidoContract(signer)
        const _weiAmount =
          tokenType === "ETH" ? ethers.parseUnits(_amount, 18) : ethers.parseUnits(_amount.toString(), 6)

        const loadingToastId = toast.loading("Processing loan request...")

        try {
          await contract.requestLoanFromListing.staticCall(_orderId, _weiAmount)

          const transaction = await contract.requestLoanFromListing(_orderId, _weiAmount)
          const receipt = await transaction.wait()

          if (receipt.status) {
            toast.success("You accepted listed ads successfully!", { id: loadingToastId })
            router.push("/")
            return
          }

          toast.error("failed!", { id: loadingToastId })
        } catch (error: unknown) {
          const err = await errorDecoder.decode(error)
          console.log("Error accepting listed ads:", err)

          const errorText = ERROR_MESSAGES[err?.fragment?.name || err?.selector] || "Failed to accept bid!"
          toast.warning(`Error: ${errorText}`, { id: loadingToastId })
        }
      } catch (adapterError) {
        // console.error("Adapter error:", adapterError)
        toast.error("Failed to connect to wallet")
      }
    },
    [activeAccount, activeChain, chainId, router],
  )
}

export default useAcceptListedAds
