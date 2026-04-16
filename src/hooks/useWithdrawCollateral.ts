"use client"
import { useCallback } from "react"
import { toast } from "sonner"
import { isSupportedChain } from "@/config/chain"
import { getProvider } from "@/config/provider"
import { useRouter } from "next/navigation"
import { ErrorWithReason } from "@/constants/types"
import { ethers } from "ethers"
import { getContractByChainId } from "@/config/getContractByChain"
import { ADDRESS_1, USDC_ADDRESS, USDR, USDT_ADDRESS, kfUSD_ADDRESS } from "@/constants/utils/addresses"
import { SUPPORTED_CHAIN_ID } from "@/context/web3Modal"
import { ErrorDecoder } from "ethers-decode-error"
import lendbitAbi from "@/abi/ProtocolFacet.json"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { client } from "@/config/client"
import { getKaleidoContract } from "@/config/contracts"

const errorDecoder = ErrorDecoder.create([lendbitAbi])

const useWithdrawCollateral = () => {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id
  const address = activeAccount?.address
  const router = useRouter()

  return useCallback(
    async (_tokenCollateralAddress: string, _amountOfCollateral: string) => {
      if (!isSupportedChain(chainId)) return toast.warning("SWITCH NETWORK")

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

      let toastId: string | number | undefined

      try {
        let _weiAmount
        // Ensure _amountOfCollateral is treated as a string
        const amountStr = String(_amountOfCollateral)

        if (_tokenCollateralAddress === ADDRESS_1) {
          _weiAmount = ethers.parseUnits(amountStr, 18) // 18 decimals for ETH
        } else if (_tokenCollateralAddress === USDC_ADDRESS) {
          _weiAmount = ethers.parseUnits(amountStr, 6) // 6 decimals for USDC
        } else if (_tokenCollateralAddress === USDR) {
          _weiAmount = ethers.parseUnits(amountStr, 18)
        } else if (_tokenCollateralAddress === kfUSD_ADDRESS) {
          _weiAmount = ethers.parseUnits(amountStr, 18)
        } else if (_tokenCollateralAddress === USDT_ADDRESS) {
          _weiAmount = ethers.parseUnits(amountStr, 6)
        }

        // Show loading toast when the withdraw transaction is initiated
        toastId = toast.loading(`Signing tx... Withdrawing collateral...`)

        await contract.withdrawCollateral.staticCall(_tokenCollateralAddress, _weiAmount)
        const transaction = await contract.withdrawCollateral(_tokenCollateralAddress, _weiAmount)

        const receipt = await transaction.wait()

        if (receipt.status) {
          toast.success(`${_amountOfCollateral} successfully withdrawn!`, {
            id: toastId,
          })
          return router.push("/")
        } else {
          toast.error("Failed to withdraw collateral.", {
            id: toastId,
          })
        }
      } catch (error: unknown) {
        // console.error(error)
        // console.error("Error withdrawing:", await errorDecoder.decode(error))
        const err = await errorDecoder.decode(error)
        let errorText: string

        if (err?.reason === "Protocol__InsufficientCollateralDeposited") {
          errorText = "Insufficient collateral!"
        } else if (err?.reason === "Protocol__TransferFailed") {
          errorText = "Transaction failed!"
        } else {
          errorText = "Action canceled or failed!"
        }

        if (toastId) {
          toast.error(`Error: ${errorText}`, { id: toastId })
        } else {
          // Fallback toast if no loading toast was created
          toast.error(`Error: ${errorText}`)
        }
      }
    },
    [chainId, router],
  )
}

export default useWithdrawCollateral
