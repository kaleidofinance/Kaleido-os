"use client"

import { getContractByChainId } from "@/config/getContractByChain"
import { getProvider } from "@/config/provider"
import { useCallback } from "react"
import { Contract } from "ethers"
import { IUseCloseRequest } from "@/constants/interfaces/ProtocolInterfaces"
import { ErrorDecoder } from "ethers-decode-error"
import lendbitAbi from "@/abi/ProtocolFacet.json"
import { toast } from "sonner"
import { ethers } from "ethers"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { client } from "@/config/client"
import { getKaleidoContract } from "@/config/contracts"

const errorDecoder = ErrorDecoder.create([lendbitAbi])

export default function useCloseRequest(): IUseCloseRequest {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id
  const address = activeAccount?.address
  // const { walletProvider } = useWeb3ModalProvider();

  const closeRequest = useCallback(
    async (listingId: number): Promise<void> => {
      if (!activeAccount || !chainId || !address) {
        console.warn("Wallet not connected or missing required context.")
        return
      }
      const loadingToastId = toast.loading("Closing the Request...")

      try {
        if (!activeChain) {
          toast.error("Chain not connected")
          return
        }
        if (!activeAccount) {
          toast.error("invalid account")
          return
        }
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

        await contract.closeRequest.staticCall(listingId)
        const tx = await contract.closeRequest(listingId)
        handleTransactionResult(tx, loadingToastId)
        // console.log("Transaction sent:", tx.hash);

        const receipt = await tx.wait()
        // console.log("Transaction confirmed:", receipt);
      } catch (err: any) {
        handleError(err, loadingToastId)
        // console.error("Error closing Request:", errorDecoder.decode(err))
        // console.error("Error closing Request:", err?.message || err)
      }
    },
    [chainId, address],
  )

  const handleError = async (error: unknown, loadingToastId: string | number | undefined) => {
    const err = await errorDecoder.decode(error)
    let errorText: string

    switch (err?.fragment?.name) {
      case "Protocol__MustBeMoreThanZero":
        errorText = "Invalid borrow amount!"
        break
      case "Protocol__RequestNotOpen":
        errorText = "Request Closed!"
        break
      case "Protocol__OwnerCreatedOrder":
        errorText = "only owner can close request!"
        break
      default:
        errorText = "Trying to resolve error!"
    }

    toast.warning(`Error: ${errorText}`, { id: loadingToastId })
    // console.error("ERROR", err)
  }

  const handleTransactionResult = async (transaction: ethers.Contract, loadingToastId: string | number | undefined) => {
    const receipt = await transaction.wait()
    if (receipt.status) {
      toast.success("Request Successfully closed!", { id: loadingToastId })
    } else {
      toast.error("Transaction failed!", { id: loadingToastId })
    }
  }

  return { closeRequest }
}
