"use client"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { isSupportedChain } from "@/config/chain"
import { getProvider } from "@/config/provider"
import { getERC20Contract, getKaleidoContract } from "@/config/contracts"
import { useRouter } from "next/navigation"
import { ErrorWithReason } from "@/constants/types"
import { ethers } from "ethers"
import { ADDRESS_1, USDC_ADDRESS, USDR, USDT_ADDRESS, kfUSD_ADDRESS } from "@/constants/utils/addresses"
import useCheckAllowance from "./useCheckAllowance"
import { MaxUint256 } from "ethers"
import { getUsdcAddressByChainId } from "@/constants/utils/getUsdcBalance"
import { getContractAddressesByChainId, getContractByChainId } from "@/config/getContractByChain"
import { SUPPORTED_CHAIN_ID } from "@/context/web3Modal"
import { ErrorDecoder } from "ethers-decode-error"
import lendbitAbi from "@/abi/ProtocolFacet.json"
import { formatInterestRate } from "@/constants/utils/FormatInterestRate"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { client } from "@/config/client"

const errorDecoder = ErrorDecoder.create([lendbitAbi])
import { sendLoanCreatedNotification } from "@/utils/notificationService"
import useGetValueAndHealth from "./useGetValueAndHealth"

const useCreateLoanListing = () => {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id
  const address = activeAccount?.address
  const router = useRouter()
  const { val, usdrVal, kfusdVal, usdtVal } = useCheckAllowance()
  const { etherPrice, usdcPrice } = useGetValueAndHealth()

  // Remove the separate state variables - use the prices directly from the hook

  const handleTransactionResult = async (transaction: ethers.Contract, loadingToastId: string | number | undefined) => {
    const receipt = await transaction.wait()
    if (receipt.status) {
      toast.success("Loan order created!", { id: loadingToastId })
      if (address) {
        sendLoanCreatedNotification(address, "lending")
      }
      router.push("/successful")
    } else {
      toast.error("Transaction failed!", { id: loadingToastId })
    }
  }

  return useCallback(
    async (
      _amount: string,
      _min_amount: number,
      _max_amount: number,
      _returnDate: number,
      _interest: number,
      _loanCurrency: string,
    ) => {
      if (!isSupportedChain(chainId)) {
        toast.warning("SWITCH NETWORK")
        return // Early return if chain is not supported
      }

      const currency =
        _loanCurrency === "ETH"
          ? ADDRESS_1
          : _loanCurrency === "USDC"
            ? USDC_ADDRESS
            : _loanCurrency === "USDR"
              ? USDR
              : _loanCurrency === "kfUSD"
                ? kfUSD_ADDRESS
                : _loanCurrency === "USDT"
                  ? USDT_ADDRESS
                  : ""

      let _weiAmount
      let _min_amount_wei
      let _max_amount_wei

      if (_loanCurrency === "ETH") {
        _weiAmount = ethers.parseUnits(_amount, 18)
        _min_amount_wei = ethers.parseUnits(_min_amount.toFixed(18).toString(), 18)
        _max_amount_wei = ethers.parseUnits(_max_amount.toFixed(18).toString(), 18)
        console.log("min in wei:", _weiAmount)
      } else {
        let decimals = 6
        if (_loanCurrency === "USDR" || _loanCurrency === "kfUSD") {
          decimals = 18
        } else if (_loanCurrency === "USDT") {
          decimals = 6
        }
        
        _weiAmount = ethers.parseUnits(_amount, decimals)
        _min_amount_wei = ethers.parseUnits(_min_amount.toFixed(decimals).toString(), decimals)
        _max_amount_wei = ethers.parseUnits(_max_amount.toFixed(decimals).toString(), decimals)
      }

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
      const destination: any = getContractAddressesByChainId(chainId)
      let loadingToastId: string | number | undefined

      try {
        loadingToastId = toast.loading("Processing order...")

        if (_loanCurrency === "ETH") {
          await contract.createLoanListing.staticCall(
            _weiAmount,
            _min_amount_wei,
            _max_amount_wei,
            _returnDate,
            formatInterestRate(_interest),
            currency,
            { value: _weiAmount },
          )

          const transaction = await contract.createLoanListing(
            _weiAmount,
            _min_amount_wei,
            _max_amount_wei,
            _returnDate,
            formatInterestRate(_interest),
            currency,
            { value: _weiAmount },
          )

          await handleTransactionResult(transaction, loadingToastId)
        } else {
          if (currency === USDC_ADDRESS) {
            if (val === 0 || val < Number(_amount)) {
              const erc20contract = getERC20Contract(signer, currency)
              const allowance = await erc20contract.approve(destination, _weiAmount)
              await allowance.wait()
              toast.success("Approval granted!")
            }
          } else if (currency === USDR) {
            if (usdrVal == 0 || usdrVal < Number(_amount)) {
              const erc20contract = getERC20Contract(signer, currency)
              const allowance = await erc20contract.approve(destination, _weiAmount)
              await allowance.wait()
              toast.success("Approval granted!")
            }
          } else if (currency === kfUSD_ADDRESS) {
            if (kfusdVal == 0 || kfusdVal < Number(_amount)) {
              const erc20contract = getERC20Contract(signer, currency)
              const allowance = await erc20contract.approve(destination, _weiAmount)
              await allowance.wait()
              toast.success("Approval granted!")
            }
          } else if (currency === USDT_ADDRESS) {
            if (usdtVal == 0 || usdtVal < Number(_amount)) {
              const erc20contract = getERC20Contract(signer, currency)
              const allowance = await erc20contract.approve(destination, _weiAmount)
              await allowance.wait()
              toast.success("Approval granted!")
            }
          }

          await contract.createLoanListing.staticCall(
            _weiAmount,
            _min_amount_wei,
            _max_amount_wei,
            _returnDate,
            formatInterestRate(_interest),
            currency,
          )

          const transaction = await contract.createLoanListing(
            _weiAmount,
            _min_amount_wei,
            _max_amount_wei,
            _returnDate,
            formatInterestRate(_interest),
            currency,
          )

          await handleTransactionResult(transaction, loadingToastId)
        }
      } catch (error: unknown) {
        // console.error("Error creating loan listing:", error)
        handleError(error, loadingToastId)
      }
    },
    [chainId, val, usdrVal, kfusdVal, usdtVal, router, etherPrice, usdcPrice], // Include the prices and usdrVal in dependencies
  )
}

const handleError = async (error: unknown, loadingToastId: string | number | undefined) => {
  const err = await errorDecoder.decode(error)
  let errorText: string
  console.log("Error details:", err)
  switch (err?.fragment?.name) {
    case "Protocol__DateMustBeInFuture":
      errorText = "Input a valid date!"
      break
    case "Protocol__TokenNotLoanable":
      errorText = "Token not loanable!"
      break
    case "Protocol__InsufficientBalance":
      errorText = "Insufficient balance!"
      break
    case "Protocol__InsufficientAllowance":
      errorText = "Insufficient allowance!"
      break
    case "Protocol__TransferFailed":
      errorText = "Listing action failed!"
      break
    case "Protocol__DateMustBeInFuture":
      errorText = "Input a valid date!"
      break
    case "Protocol__LoanAmountTooLow":
      errorText = "The minimum order amount is $10!"
      break
    default:
      errorText = "Unknown error occurred!"
  }

  toast.error(`${errorText}`, { id: loadingToastId })
  // console.error("ERROR", err)
}

export default useCreateLoanListing
