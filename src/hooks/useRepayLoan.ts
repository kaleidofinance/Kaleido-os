"use client"

import { useCallback } from "react"
import { toast } from "sonner"
import { isSupportedChain } from "@/config/chain"
import { getProvider } from "@/config/provider"
import { getERC20Contract, getKaleidoContract } from "@/config/contracts"
import { ErrorWithReason } from "@/constants/types"
import useCheckAllowance from "./useCheckAllowance"
import { ADDRESS_1, USDC_ADDRESS, USDR } from "@/constants/utils/addresses"
import { ethers, MaxUint256 } from "ethers"
import { getContractAddressesByChainId, getContractByChainId } from "@/config/getContractByChain"
import { getUsdcAddressByChainId } from "@/constants/utils/getUsdcBalance"
import { SUPPORTED_CHAIN_ID } from "@/context/web3Modal"
import { ErrorDecoder } from "ethers-decode-error"
import lendbitAbi from "@/abi/ProtocolFacet.json"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { client } from "@/config/client"

const errorDecoder = ErrorDecoder.create([lendbitAbi])
const useRepayLoan = () => {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id
  // console.log("chainId:", chainId)
  const address = activeAccount?.address

  const { val, usdrVal } = useCheckAllowance()

  return useCallback(
    async (_requestId: number, _tokenAddress: string, _amount: string) => {
      // if (chainId === undefined) return
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

      let currency: any
      if (_tokenAddress === USDC_ADDRESS) {
        currency = USDC_ADDRESS
      } else if (_tokenAddress === USDR) {
        currency = USDR
      }

      const contract = getKaleidoContract(signer)
      const destination = getContractAddressesByChainId(chainId)

      // const _amount = ethers.parseEther(_amount);
      // console.log(_requestId, _tokenAddress,_amount, _amount);

      let loadingToastId: string | number | undefined

      try {
        loadingToastId = toast.loading("Please wait!... Processing repayments")

        // If the token address is ADDRESS_1, directly call repayLoan for native token (like ETH)
        if (_tokenAddress === ADDRESS_1) {
          await contract.repayLoan.staticCall(_requestId, _amount, {
            value: _amount,
          })

          const transaction = await contract.repayLoan(_requestId, _amount, {
            value: _amount,
          })

          const receipt = await transaction.wait()

          if (receipt.status) {
            return toast.success("Outstanding payed!", {
              id: loadingToastId,
            })
          }

          return toast.error("Repayment failed!", {
            id: loadingToastId,
          })
        }

        // If the token is a different ERC-20 token (e.g., USDC), check allowance first
        if (_tokenAddress !== ADDRESS_1) {
          const erc20Contract = getERC20Contract(signer, currency)

          // Check if allowance is sufficient
          if (_tokenAddress === USDC_ADDRESS) {
            if (val === 0 || val < Number(_amount)) {
              const approvalAmount = ethers.parseUnits(_amount, 6);
              const approvalTx = await erc20Contract.approve(destination, approvalAmount)
              const approvalReceipt = await approvalTx.wait()

              if (!approvalReceipt.status) {
                return toast.error("Approval failed!", {
                  id: loadingToastId,
                })
              }
            }
          } else if (_tokenAddress === USDR) {
            if (usdrVal === 0 || usdrVal < Number(_amount)) {
              const approvalAmount = ethers.parseUnits(_amount, 18);
              const approvalTx = await erc20Contract.approve(destination, approvalAmount)
              const approvalReceipt = await approvalTx.wait()

              if (!approvalReceipt.status) {
                return toast.error("Approval failed!", {
                  id: loadingToastId,
                })
              }
            }
          }
          await contract.repayLoan.staticCall(_requestId, _amount)
          const transaction = await contract.repayLoan(_requestId, _amount)

          const receipt = await transaction.wait()

          if (receipt.status) {
            return toast.success("Outstanding payed!", {
              id: loadingToastId,
            })
          }

          return toast.error("Repayment failed!", {
            id: loadingToastId,
          })
        }
      } catch (error: unknown) {
        const err = await errorDecoder.decode(error)
        console.log("Error rapaying loan:", err)
        let errorText: string

        // Handle different error reasons from the protocol
        switch (err?.reason) {
          case "Protocol__RequestNotServiced":
            errorText = "Repayment action failed!"
            break
          case "Protocol__InvalidToken":
          case "Protocol__InsufficientBalance":
            errorText = "Insufficient balance!"
            break
          case "Protocol__InsufficientAllowance":
            errorText = "Insufficient allowance!"
            break
          case "Protocol__MustBeMoreThanZero":
            errorText = "No outstanding to repay!"
            break
          default:
            errorText = "Trying to resolve error!"
        }

        toast.warning(`Error: ${errorText}`, {
          id: loadingToastId,
        })
      }
    },
    [val, usdrVal],
  )
}

export default useRepayLoan
