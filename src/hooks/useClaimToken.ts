"use client"

import { getTokenFaucetContract } from "@/config/contracts"
import { useCallback } from "react"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { toast } from "sonner"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { client } from "@/config/client"
import useTxFactory from "@/components/factory/TxFactory"

const useClaimToken = () => {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const { handleError, handleTransactionResult } = useTxFactory()

  const claimToken = useCallback(async () => {
    if (!activeChain) {
      toast.error("Chain not connected")
      return
    }

    if (!activeAccount) {
      toast.error("Invalid account")
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

    const contract = getTokenFaucetContract(signer)

    let loadingToastId: any
    try {
      loadingToastId = toast.loading("Claiming tokens from faucet...")

      await contract.claimToken.staticCall()

      const transaction = await contract.claimToken()
      const tx = await transaction.wait()

      await handleTransactionResult(transaction, loadingToastId, "usdc")
    } catch (error) {
      await handleError(error, loadingToastId)
    }
  }, [activeAccount, activeChain, handleError, handleTransactionResult])

  const claimKLDToken = useCallback(async () => {
    if (!activeChain) {
      toast.error("Chain not connected")
      return
    }

    if (!activeAccount) {
      toast.error("Invalid account")
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

    const contract = getTokenFaucetContract(signer)

    let loadingToastId: any
    try {
      loadingToastId = toast.loading("Claiming $KLD from faucet...")

      await contract.claimKLD.staticCall()

      const transaction = await contract.claimKLD()
      const tx = await transaction.wait()

      await handleTransactionResult(transaction, loadingToastId, "kld")
    } catch (error) {
      await handleError(error, loadingToastId)
    }
  }, [activeAccount, activeChain, handleError, handleTransactionResult])
  return { claimToken, claimKLDToken }
}

export default useClaimToken
