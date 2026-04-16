"use client"
import { useCallback } from "react"
import { toast } from "sonner"
import { isSupportedChain } from "@/config/chain"
import { getProvider } from "@/config/provider"
import { getERC20Contract, getKaleidoContract } from "@/config/contracts"
import { useRouter } from "next/navigation"
import { ErrorWithReason } from "@/constants/types"
import { ethers, MaxUint256 } from "ethers"
import useCheckAllowance from "./useCheckAllowance"
import { getContractAddressesByChainId, getContractByChainId } from "@/config/getContractByChain"
import { getUsdcAddressByChainId } from "@/constants/utils/getUsdcBalance"
import { SUPPORTED_CHAIN_ID } from "@/context/web3Modal"
import { ErrorDecoder } from "ethers-decode-error"
import lendbitAbi from "@/abi/ProtocolFacet.json"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { client } from "@/config/client"
import { USDC_ADDRESS, USDR, USDT_ADDRESS, kfUSD_ADDRESS } from "@/constants/utils/addresses"

const errorDecoder = ErrorDecoder.create([lendbitAbi])

const useDepositCollateral = () => {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id
  const address = activeAccount?.address
  const router = useRouter()
  const { val, usdrVal, kfusdVal, usdtVal } = useCheckAllowance()

  return useCallback(
    async (_amountOfCollateral: string, tokenAddress: string) => {
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
      let currency: any
      let decimals = 18

      if (tokenAddress === USDC_ADDRESS) {
        currency = USDC_ADDRESS
        decimals = 6
      } else if (tokenAddress === USDR) {
        currency = USDR
        decimals = 18
      } else if (tokenAddress === kfUSD_ADDRESS) {
        currency = kfUSD_ADDRESS
        decimals = 18
      } else if (tokenAddress === USDT_ADDRESS) {
        currency = USDT_ADDRESS
        decimals = 6
      }

      const destination = getContractAddressesByChainId(chainId)

      const erc20contract = getERC20Contract(signer, currency)
      const _weiAmount = ethers.parseUnits(_amountOfCollateral, decimals)
      let toastId: string | number | undefined

      // console.log("val", val);

      try {
        toastId = toast.loading(`Processing deposit transaction...`)

        // Check allowance before proceeding
        if (tokenAddress === USDC_ADDRESS) {
          if (val == 0 || val < Number(_amountOfCollateral)) {
            // console.log("destination", destination);

            const allowance = await erc20contract.approve(destination, _weiAmount)
            const allReceipt = await allowance.wait()

            if (!allReceipt.status) {
              return toast.error("Approval failed!", { id: toastId })
            }
          }
        } else if (tokenAddress === USDR) {
          if (usdrVal == 0 || usdrVal < Number(_amountOfCollateral)) {
            const allowance = await erc20contract.approve(destination, _weiAmount)
            const allReceipt = await allowance.wait()

            if (!allReceipt.status) {
              return toast.error("Approval failed!", { id: toastId })
            }
          }
        } else if (tokenAddress === kfUSD_ADDRESS) {
          if (kfusdVal == 0 || kfusdVal < Number(_amountOfCollateral)) {
            const allowance = await erc20contract.approve(destination, _weiAmount)
            const allReceipt = await allowance.wait()

            if (!allReceipt.status) {
              return toast.error("Approval failed!", { id: toastId })
            }
          }
        } else if (tokenAddress === USDT_ADDRESS) {
          if (usdtVal == 0 || usdtVal < Number(_amountOfCollateral)) {
            const allowance = await erc20contract.approve(destination, _weiAmount)
            const allReceipt = await allowance.wait()

            if (!allReceipt.status) {
              return toast.error("Approval failed!", { id: toastId })
            }
          }
        }

        await contract.depositCollateral.staticCall(currency, _weiAmount)
        let transaction
        transaction = await contract.depositCollateral(currency, _weiAmount)

        const receipt = await transaction.wait()

        if (receipt.status) {
          toast.success(`${_amountOfCollateral} successfully deposited as collateral!`, {
            id: toastId,
          })
          if (chainId !== SUPPORTED_CHAIN_ID[0]) {
            toast.message(
              `Kindly wait for few minutes for your deposited ${_amountOfCollateral} to go cross-chain!`,
            )
          }
          router.push("/")
        } else {
          toast.error("Transaction failed!", {
            id: toastId,
          })
        }
      } catch (error: unknown) {
        console.error(error)

        const err = await errorDecoder.decode(error)
        // console.log("Error while creating request", err)
        let errorText: string =
          err?.fragment?.name === "Protocol__TransferFailed" ? "Deposit action failed!" : "Action canceled or failed!"

        if (toastId) {
          toast.error(`Error: ${errorText}`, { id: toastId })
        } else {
          toast.warning(`Error: ${errorText}`)
        }
      }
    },
    [chainId, router, val, usdrVal, kfusdVal, usdtVal],
  )
}

export default useDepositCollateral
