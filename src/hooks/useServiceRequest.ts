"use client"

import { useCallback } from "react"
import { toast } from "sonner"
import { getProvider } from "@/config/provider"
import { getERC20Contract, getKaleidoContract } from "@/config/contracts"
import { ErrorDecoder } from "ethers-decode-error"
import { ethers, MaxUint256 } from "ethers"

import lendbitAbi from "@/abi/ProtocolFacet.json"
import useCheckAllowance from "./useCheckAllowance"

import { ADDRESS_1, USDC_ADDRESS, USDR } from "@/constants/utils/addresses"
import { getContractByChainId } from "@/config/getContractByChain"
import { getContractAddressesByChainId } from "@/config/getContractByChain"
import { getUsdcAddressByChainId } from "@/constants/utils/getUsdcBalance"

import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { client } from "@/config/client"

const errorDecoder = ErrorDecoder.create([lendbitAbi])
import { sendLoanFilledNotification } from "@/utils/notificationService"

const useServiceRequest = () => {
  const { val, usdrVal } = useCheckAllowance()
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id
  const address = activeAccount?.address

  return useCallback(
    async (_requestId: number, _tokenAddress: string, _amount: string) => {
      // console.log("This is the amount to be passed:", _amount)
      // console.log("Amount being sent:", _amount)
      // console.log("Parsed amount:", ethers.parseUnits(_amount, 18).toString())
      // console.log("msg.value will be:", ethers.parseUnits(_amount, 18).toString())
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
      const protocolAddress = getContractAddressesByChainId(chainId)

      // const valueToSend = ethers.parseEther(_amount)
      const ethAmount = BigInt(_amount) // Use the wei amount directly

      // console.log("Amount in wei:", ethAmount.toString())
      // console.log("Amount in ETH:", ethers.formatEther(ethAmount))

      // console.log("valueToSend", valueToSend.toString())

      let loadingToastId = toast.loading("Processing service request...")

      try {
        const isNativeToken = _tokenAddress === ADDRESS_1
        let tx

        if (isNativeToken) {
          await contract.serviceRequest.staticCall(_requestId, _tokenAddress, {
            value: ethAmount,
          })
          tx = await contract.serviceRequest(_requestId, _tokenAddress, {
            value: ethAmount,
          })
        } else {
          const erc20 = getERC20Contract(signer, currency)

          if (currency === USDC_ADDRESS) {
            if (val === 0 || val < Number(_amount)) {
              const approvalAmount = ethers.parseUnits(_amount, 6);
              const approvalTx = await erc20.approve(protocolAddress, approvalAmount)
              const approvalReceipt = await approvalTx.wait()

              if (!approvalReceipt.status) {
                toast.error("Approval failed!", { id: loadingToastId })
                return
              }
            }
          } else if (currency === USDR) {
            if (usdrVal == 0 || usdrVal < Number(_amount)) {
              const approvalAmount = ethers.parseUnits(_amount, 18);
              const approvalTx = await erc20.approve(protocolAddress, approvalAmount)
              const approvalReceipt = await approvalTx.wait()

              if (!approvalReceipt.status) {
                toast.error("Approval failed!", { id: loadingToastId })
                return
              }
            }
          }

          await contract.serviceRequest.staticCall(_requestId, _tokenAddress)
          tx = await contract.serviceRequest(_requestId, _tokenAddress)
        }

        const receipt = await tx.wait()
        if (receipt.status) {
          toast.success("Request serviced!", { id: loadingToastId })
          if (address) {
            sendLoanFilledNotification(address)
          }
        } else {
          toast.error("Request servicing failed!", { id: loadingToastId })
        }
      } catch (error: unknown) {
        const decoded = await errorDecoder.decode(error)
        console.error("Service Request Error:", decoded)

        let errorText = "Unknown error occurred."
        switch (decoded?.fragment?.name || decoded?.reason) {
          case "Protocol__RequestNotOpen":
            errorText = "Request has already been serviced or closed."
            break
          case "Protocol__InvalidToken":
            errorText = "Invalid token specified."
            break
          case "Protocol__CantFundSelf":
            errorText = "You cannot service your own request."
            break
          case "Protocol__InsufficientBalance":
            errorText = "Insufficient balance."
            break
          case "Protocol__InsufficientCollateral":
            errorText = "Borrower has insufficient collateral."
            break
          case "Protocol__InsufficientAllowance":
            errorText = "Token allowance too low."
            break
          case "Protocol__RequestExpired":
            errorText = "Request has expired."
            break
          case "Request is being rate limited":
            errorText = "Request is being rate limited"
            break
          case "Protocol__InsufficientCollateralBalance":
            errorText = "Borrower's collateral balance is insufficient to cover this loan."
            break
        }

        toast.error(`Error: ${errorText} `, { id: loadingToastId })
      }
    },
    [usdrVal, val],
  )
}

export default useServiceRequest
