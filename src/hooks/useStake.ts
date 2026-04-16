"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { getProvider } from "@/config/provider"
import { getKLDVaultContract } from "@/config/contracts"
import { ErrorDecoder } from "ethers-decode-error"
import { ethers, MaxUint256 } from "ethers"
import KLDVaultAbi from "@/abi/KLDVaultAbi.json"
import erc20Abi from "@/abi/ERC20Abi.json"
import { KLD_ADDRESS, stKLD_ADDRESS } from "@/constants/utils/addresses"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { client } from "@/config/client"
import useTxFactory from "@/components/factory/TxFactory"
import { envVars } from "@/constants/envVars"

const errorDecoder = ErrorDecoder.create([KLDVaultAbi])

const useStake = () => {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const [txStakeStatus, setTxStatus] = useState(false)
  const { handleStakeError, StakeTransactionResult } = useTxFactory()
  const chainId = activeChain?.id
  const address = activeAccount?.address

  const Stake = useCallback(
    async (_amount: string) => {
      const amountinWei = ethers.parseUnits(_amount, 18)
      if (!activeChain) {
        toast.error("Chain not connected")
        return
      }
      if (!activeAccount) {
        toast.error("invalid account")
        return
      }
      if (Number(_amount) == 0) {
        toast.error("amount must be greater than 0")
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
      let loadingToastId = toast.loading(`Staking ${_amount.toString()} $KLD...`)

      try {
        setTxStatus(true)
        const KldTokenContract = new ethers.Contract(KLD_ADDRESS, erc20Abi, signer)

        // Approve vault to spend tokens

        const approveTx = await KldTokenContract.approve(envVars.vaultAddress, ethers.parseUnits(_amount, 18))
        await approveTx.wait()
        await contract.deposit.staticCall(KLD_ADDRESS, stKLD_ADDRESS, amountinWei)
        const transaction = await contract.deposit(KLD_ADDRESS, stKLD_ADDRESS, amountinWei)
        const receipt = transaction.wait()

        await StakeTransactionResult(transaction, loadingToastId, "stake")
      } catch (error) {
        await handleStakeError(error, loadingToastId)
      } finally {
        setTxStatus(false)
      }
    },
    [activeChain, activeAccount, client, handleStakeError],
  )

  return {
    Stake,
    txStakeStatus,
  }
}

export default useStake
