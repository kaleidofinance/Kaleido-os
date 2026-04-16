"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { getProvider } from "@/config/provider"
import { getKLDVaultContract } from "@/config/contracts"
import { ErrorDecoder } from "ethers-decode-error"
import { ethers, MaxUint256 } from "ethers"
import KLDVaultAbi from "@/abi/KLDVaultAbi.json"

import { KLD_ADDRESS, stKLD_ADDRESS } from "@/constants/utils/addresses"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { client } from "@/config/client"
import useTxFactory from "@/components/factory/TxFactory"

const useCancelWithdrawalRequest = () => {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const [cancelWithdrawalRequestStatus, setTxStatus] = useState(false)
  const { handleStakeError, StakeTransactionResult } = useTxFactory()
  const chainId = activeChain?.id
  const address = activeAccount?.address

  const cancelWithdrawalRequest = useCallback(async () => {
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

    const contract = getKLDVaultContract(signer)
    let loadingToastId = toast.loading(`Cancelling your withdrawal Request`)

    try {
      setTxStatus(true)
      await contract.cancelWithdrawalRequest.staticCall()
      const transaction = await contract.cancelWithdrawalRequest()
      const receipt = transaction.wait()
      await StakeTransactionResult(transaction, loadingToastId, "cancel")
    } catch (error) {
      await handleStakeError(error, loadingToastId)
    } finally {
      setTxStatus(false)
    }
  }, [activeChain, activeAccount, client, handleStakeError])

  return {
    cancelWithdrawalRequest,
    cancelWithdrawalRequestStatus,
  }
}

export default useCancelWithdrawalRequest
