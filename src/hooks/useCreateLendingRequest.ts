"use client"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { isSupportedChain } from "@/config/chain"
import { getProvider } from "@/config/provider"
import { useRouter } from "next/navigation"
import { ErrorWithReason } from "@/constants/types"
import { ethers } from "ethers"
import { ADDRESS_1, USDC_ADDRESS, USDR, USDT_ADDRESS, kfUSD_ADDRESS } from "@/constants/utils/addresses"
import { getContractByChainId } from "@/config/getContractByChain"
import { getUsdcAddressByChainId } from "@/constants/utils/getUsdcBalance"
import { SUPPORTED_CHAIN_ID } from "@/context/web3Modal"
import { getKaleidoContract } from "@/config/contracts"
import { ErrorDecoder } from "ethers-decode-error"
import lendbitAbi from "@/abi/ProtocolFacet.json"
import { formatInterestRate } from "@/constants/utils/FormatInterestRate"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { client } from "@/config/client"

const errorDecoder = ErrorDecoder.create([lendbitAbi])
import { sendLoanCreatedNotification } from "@/utils/notificationService"
import useGetValueAndHealth from "./useGetValueAndHealth"

const useCreateLendingRequest = () => {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id
  const address = activeAccount?.address
  const router = useRouter()

  const { etherPrice, usdcPrice } = useGetValueAndHealth()

  //Utils function
  const getCalculateMinPriceBasedOnToken = (tokenAddress: string, amount: string) => {
    let price
    if (tokenAddress === ADDRESS_1) {
      price = etherPrice // Use directly from hook
    } else if (tokenAddress === USDC_ADDRESS || tokenAddress === USDR) {
      price = usdcPrice // Use directly from hook
    }

    // Check if price is valid (should be > 0 for real tokens)
    if (!price || price <= 0) {
      console.error("Invalid price data:", price)
      toast.error("Price data is loading. Please try again in a moment.")
      return false
    }

    // Convert amount from string to number for USD value calculation
    const amountNum = parseFloat(amount)

    // Check if amount is valid
    if (isNaN(amountNum) || amountNum <= 0) {
      console.error("Invalid amount:", amount, amountNum)
      toast.error("Please enter a valid amount")
      return false
    }

    // Calculate USD value of the order
    const usdValue = price * amountNum
    console.log("USD Value calculation:", price, "*", amountNum, "=", usdValue)

    // Minimum order amount in USD
    const MIN_ORDER_USD = 10
    if (usdValue < MIN_ORDER_USD) {
      toast.error(`The minimum order amount is $${MIN_ORDER_USD}.`)
      return false
    }

    return true
  }

  const handleTransactionResult = async (transaction: any, loadingToastId: string | number | undefined) => {
    const receipt = await transaction.wait()

    if (receipt.status && SUPPORTED_CHAIN_ID[0] == chainId) {
      toast.success("Loan Pool created!", {
        id: loadingToastId,
      })
      if (address) {
        sendLoanCreatedNotification(address, "borrow")
      }
      return router.push("/successful")
    } else if (receipt.status && chainId !== SUPPORTED_CHAIN_ID[0]) {
      toast.success("Loan Pool created, kindly wait for few minutes!", {
        id: loadingToastId,
      })
      if (address) {
        sendLoanCreatedNotification(address, "borrow")
      }
      return router.push("/successful")
    } else {
      toast.error("Pool creation failed!", {
        id: loadingToastId,
      })
    }
  }

  const handleError = async (error: unknown, loadingToastId: string | number | undefined) => {
    const err = await errorDecoder.decode(error)
    console.log("Error details:", err)
    let errorText: string

    switch (err?.fragment?.name) {
      case "Protocol__TokenNotLoanable":
        errorText = "Token not loanable!"
        break
      case "Protocol__DateMustBeInFuture":
        errorText = "Input a valid date!"
        break
      case "Protocol__InvalidAmount":
        errorText = "Please input a valid amount!"
        break
      case "Protocol__InsufficientCollateral":
        errorText = "Insufficient collateral!"
        break
      case "Protocol__CannotBorrowCollateralAsset":
        errorText = "You cannot borrow collateral asset!"
        break
      case "Protocol__LoanAmountTooLow":
        errorText = "The minimum order amount is $10!"
        break
      default:
        errorText = "Unknown error occurred!"
    }

    toast.error(`${errorText}`, {
      id: loadingToastId,
    })
    console.log("Error while creating lending request", error)
  }

  return useCallback(
    async (_amount: string, _interest: number, _returnDate: number, _loanCurrency: string) => {
      if (!isSupportedChain(chainId)) {
        toast.warning("SWITCH NETWORK", { duration: 1000 })
        return
      }

      let _weiAmount
      let currency: any

      if (_loanCurrency === "ETH") {
        currency = ADDRESS_1
        _weiAmount = ethers.parseEther(_amount.toString())
      } else if (_loanCurrency === "USDC") {
        currency = USDC_ADDRESS
        _weiAmount = ethers.parseUnits(_amount.toString(), 6)
      } else if (_loanCurrency === "USDR") {
        currency = USDR
        _weiAmount = ethers.parseUnits(_amount.toString(), 18) // USDR is 18 decimals
      } else if (_loanCurrency === "kfUSD") {
        currency = kfUSD_ADDRESS
        _weiAmount = ethers.parseUnits(_amount.toString(), 18)
      } else if (_loanCurrency === "USDT") {
        currency = USDT_ADDRESS
        _weiAmount = ethers.parseUnits(_amount.toString(), 6)
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
      let loadingToastId: string | number | undefined

      try {
        // Check price validation before proceeding

        loadingToastId = toast.loading("Processing borrowing request...")
        const _basisPointInterest: any = formatInterestRate(_interest)

        await contract.createLendingRequest.staticCall(_weiAmount, _basisPointInterest, _returnDate, currency)
        const transaction = await contract.createLendingRequest(_weiAmount, _basisPointInterest, _returnDate, currency)

        await handleTransactionResult(transaction, loadingToastId)
      } catch (error: unknown) {
        // console.error("Error creating lending request:", error)
        await handleError(error, loadingToastId)
      }
    },
    [chainId, router, address, etherPrice, usdcPrice], // Added price dependencies
  )
}

export default useCreateLendingRequest
