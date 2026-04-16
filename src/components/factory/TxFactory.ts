import { ethers } from "ethers"
import { ErrorDecoder } from "ethers-decode-error"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import tokenFaucetAbi from "@/abi/TokenFaucet.json"
import kldVaultAbi from "@/abi/KLDVaultAbi.json"

const errorDecoder = ErrorDecoder.create([tokenFaucetAbi])
const KLDvaultErrordecoder = ErrorDecoder.create([kldVaultAbi])
const useTxFactory = () => {
  const router = useRouter()
  const handleTransactionResult = async (
    transaction: ethers.Contract,
    loadingToastId: string | number | undefined,
    text: string,
  ) => {
    const receipt = await transaction.wait()
    if (receipt.status) {
      if (text === "usdc") {
        toast.success("100 USDC claimed successfully!", {
          id: loadingToastId,
          action: {
            label: "Create Order",
            onClick: () => router.push("/create-order"),
          },
        })
      } else {
        toast.success("10,000 KLD claimed successfully!", {
          id: loadingToastId,
          action: {
            label: "Create Order",
            onClick: () => router.push("/create-order"),
          },
        })
      }
      // router.push("/successful")
    } else {
      toast.error("Transaction failed!", { id: loadingToastId })
    }
  }

  const StakeTransactionResult = async (
    transaction: ethers.Contract,
    loadingToastId: string | number | undefined,
    text: string,
  ) => {
    const receipt = await transaction.wait()
    if (receipt.status) {
      if (text === "stake") {
        toast.success("You have successfully staked!", { id: loadingToastId })
      } else if (text === "request") {
        toast.success("Your request has been processed!", { id: loadingToastId })
      } else if (text === "cancel") {
        toast.success("Your withdrawal request has been cancelled!", { id: loadingToastId })
      } else {
        toast.success("You have successfully UnStaked!", { id: loadingToastId })
      }
      // router.push("/successful")
    } else {
      toast.error("Transaction failed!", { id: loadingToastId })
    }
  }

  const handleStakeError = async (error: unknown, loadingToastId: string | number | undefined) => {
    const err = await errorDecoder.decode(error)
    const vaultErr = await KLDvaultErrordecoder.decode(error)
    let errorText: string

    switch (vaultErr?.fragment?.name) {
      case "KLDVault_TokenNotSupported":
        errorText = "The token you are trying to use is not supported."
        break
      case "KLDVault_InvalidDepositAmount":
        errorText = "amount must be greater than zero."
        break
      case "KLDVault_TokenTransferFailed":
        errorText = "Token transfer failed. Please check your allowance and balance."
        break
      case "KLDVault_InvalidPoolBalance":
        errorText = "The pool balance is invalid. Please try again later."
        break
      case "KLDVault_InvalidShareBalance":
        errorText = "Invalid share balance detected."
        break
      case "KLDVault_SameTokenNotAllowed":
        errorText = "Deposit and staking tokens cannot be the same."
        break
      case "KLDVault_InvalidWithdrawAmount":
        errorText = "Withdrawal amount is invalid or exceeds your balance."
        break
      case "KLDVault_ContractInsufficientBalance":
        errorText = "Contract has insufficient balance to process your withdrawal."
        break
      case "KLDVault_InsufficientBalance":
        errorText = "You have insufficient balance for this operation."
        break
      case "KLD_VaultWithdrawalWaitingPeriodNotPassed":
        errorText = "Withdrawal waiting period has not yet passed. Please wait."
        break
      case "KLDVault_WithdrawalNotRequested":
        errorText = "No withdrawal request found. Please request withdrawal first."
        break
      case "KaleidoTokenFaucet_InsufficientContractBalance":
        errorText = "Contract has insufficient balance to fulfill the request."
        break
      case "KaleidoTokenFaucet_FailToSendToken":
        errorText = "Failed to send tokens. Please try again."
        break
      case "KLDVault_AlreadyRequestedWithdrawal":
        errorText = "You already have a pending withdrawal. Please wait or cancel it before requesting again."
        break
      case "KaleidoTokenFaucet_CooldownNotOver":
        errorText = "Please wait for the cooldown period to end before requesting again."
        break
      default:
        errorText = "An unexpected error occurred. Please try again later."
    }

    toast.error(`Error: ${errorText}`, { id: loadingToastId })
    // console.log("vault error:", vaultErr)
    // console.error("ERROR", err)
  }

  const handleError = async (error: unknown, loadingToastId: string | number | undefined) => {
    const err = await errorDecoder.decode(error)
    let errorText: string

    switch (err?.fragment?.name) {
      case "KaleidoTokenFaucet_InsufficientContractBalance":
        errorText = "Contract has insufficient balance to fulfill the request"
        break
      case "KaleidoTokenFaucet_FailToSendToken":
        errorText = "Failed to send tokens. Please try again"
        break
      case "KaleidoTokenFaucet_CooldownNotOver":
        errorText = "Please wait for the cooldown period to end before requesting again"
        break
      default:
        errorText = "An unexpected error occurred. Please try again later"
    }

    toast.error(`Error: ${errorText}`, { id: loadingToastId })
    // console.error("ERROR", err)
  }

  return { handleTransactionResult, handleError, handleStakeError, StakeTransactionResult }
}

export default useTxFactory
