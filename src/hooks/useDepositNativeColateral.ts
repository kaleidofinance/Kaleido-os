"use client"
import { useCallback } from "react"
import { toast } from "sonner"
import { isSupportedChain } from "@/config/chain"
import { getProvider } from "@/config/provider"
import { useRouter } from "next/navigation"
import { ErrorWithReason } from "@/constants/types"
import { ADDRESS_1 } from "@/constants/utils/addresses"
import { ethers } from "ethers"
import { getContractByChainId } from "@/config/getContractByChain"
import { SUPPORTED_CHAIN_ID } from "@/context/web3Modal"
import { ErrorDecoder } from "ethers-decode-error"
import lendbitAbi from "@/abi/ProtocolFacet.json"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { client } from "@/config/client"
import { getKaleidoContract } from "@/config/contracts"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"

const errorDecoder = ErrorDecoder.create([lendbitAbi])
const useDepositNativeCollateral = () => {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id
  const address = activeAccount?.address
  const router = useRouter()

  return useCallback(
    async (_amountOfCollateral: string) => {
      if (!isSupportedChain(chainId)) return toast.warning("SWITCH TO SUPPORTED CHAINS")

      if (!activeChain) {
        toast.error("Chain not connected")
        return
      }
      const amount = ethers.parseEther(_amountOfCollateral)
      if (!activeAccount) {
        toast.error("Account not connected")
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

      let toastId: string | number | undefined

      try {
        // Show loading toast when starting the transaction
        toastId = toast.loading(`Signing deposit transaction...`)

        await contract.depositCollateral.staticCall(ADDRESS_1, amount, {
          value: amount,
        })

        const transaction = await contract.depositCollateral(ADDRESS_1, amount, {
          value: amount,
        })

        // Wait for the transaction to be mined
        const receipt = await transaction.wait()

        // Update the loading toast based on the transaction receipt
        if (receipt.status) {
          toast.success(`${_amountOfCollateral} ETH successfully deposited as collateral!`, {
            id: toastId,
          })
          if (chainId !== SUPPORTED_CHAIN_ID[0]) {
            toast.message(
              `Kindly wait for few minutes for your deposited ${_amountOfCollateral} ETH to go cross-chain!`,
            )
          }
          router.push("/")
        } else {
          toast.error("Transaction failed!", {
            id: toastId,
          })
        }
      } catch (error: unknown) {
        // Handle error, update the loading toast to show an error message
        const err = await errorDecoder.decode(error)
        // console.error(contract.interface.parseError("0xc6826680"));
        // console.error("Error in depositCollateral:", err)

        let errorText: string

        if (err?.fragment?.name === "Protocol__TransferFailed") {
          errorText = "Deposit action failed!"
        }
        if (err?.fragment?.name === "spoke__InsufficientGasFee") {
          errorText = "Deposit action failed!"
        } else {
          errorText = "Transaction canceled or failed!"
        }

        // console.error(error);

        // If a toast was shown, update it with the error message
        if (toastId) {
          toast.error(`Error: ${errorText}`, { id: toastId })
        } else {
          // Fallback toast if no loading toast was created
          toast.warning(`Error: ${errorText}`)
        }
      }
    },
    [chainId, router],
  )
}

export default useDepositNativeCollateral
