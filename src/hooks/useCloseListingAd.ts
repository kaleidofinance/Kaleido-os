"use client"

import { useCallback } from "react"
import { toast } from "sonner"
import { ErrorDecoder } from "ethers-decode-error"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { IUseCloseListingAd } from "@/constants/interfaces/ProtocolInterfaces"
import { client } from "@/config/client"
import { getKaleidoContract } from "@/config/contracts"
import lendbitAbi from "@/abi/ProtocolFacet.json"
import { ethers } from "ethers"

const errorDecoder = ErrorDecoder.create([lendbitAbi])

export default function useCloseListingAd(): IUseCloseListingAd {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id
  const address = activeAccount?.address

  const handleError = async (error: unknown, loadingToastId: string | number | undefined) => {
    const err = await errorDecoder.decode(error)
    let errorText = "Trying to resolve error!"

    switch (err?.fragment?.name) {
      case "Protocol__MustBeMoreThanZero":
        errorText = "Invalid borrow amount!"
        break
      case "Protocol__OrderNotOpen":
        errorText = "Ad Closed!"
        break
      case "Protocol__OwnerCreatedOrder":
        errorText = "only owner can close ad!"
        break
    }

    toast.warning(`Error: ${errorText}`, { id: loadingToastId })
    // console.error("ERROR", err)
  }

  const handleTransactionResult = async (transaction: ethers.Contract, loadingToastId: string | number | undefined) => {
    const receipt = await transaction.wait()
    toast[receipt.status ? "success" : "error"](receipt.status ? "Ad Successfully closed!" : "Transaction failed!", {
      id: loadingToastId,
    })
  }

  const closeListingAd = useCallback(
    async (listingId: number): Promise<void> => {
      if (!activeAccount || !chainId || !address) {
        toast.warning("Wallet not connected or missing required context.")
        return
      }

      if (!activeChain) {
        toast.error("Chain not connected")
        return
      }

      const loadingToastId = toast.loading("Closing the listing Ad...")

      try {
        const signer = ethers6Adapter.signer.toEthers({
          client,
          chain: activeChain,
          account: activeAccount,
        })

        if (!signer) {
          toast.error("Signer not available")
          return
        }

        const contract = getKaleidoContract(signer)
        await contract.closeListingAd.staticCall(listingId)
        const tx = await contract.closeListingAd(listingId)
        handleTransactionResult(tx, loadingToastId)

        const receipt = await tx.wait()
        // console.log("Transaction confirmed:", receipt)
      } catch (err: any) {
        handleError(err, loadingToastId)
        console.error("Error closing listing ad:", errorDecoder.decode(err))
        // console.error("Error closing listing ad:", err?.message || err)
      }
    },
    [chainId, address],
  )

  return { closeListingAd }
}
