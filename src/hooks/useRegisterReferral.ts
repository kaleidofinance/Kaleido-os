"use client"
import { getKaleidoContract } from "@/config/contracts"
import { useCallback, useState } from "react"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { toast } from "sonner"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { client } from "@/config/client"
import { isAddress } from "ethers"
import { ErrorDecoder } from "ethers-decode-error"
import kaleidoAbi from "@/abi/ProtocolFacet.json"
import { ethers } from "ethers"
import { envVars } from "@/constants/envVars"

const errorDecoder = ErrorDecoder.create([kaleidoAbi])

export const useRegisterReferral = () => {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const address = activeAccount?.address

  const registerUpliner = useCallback(
    async (upliner: string) => {
      if (!activeChain) {
        toast.error("Chain not connected")
        return
      }
      if (!activeAccount) {
        toast.error("invalid account")
        return
      }
      if (!isAddress(upliner)) {
        toast.error("invalid upliner address")
        return
      }

      const provider = new ethers.JsonRpcProvider(envVars.httpRPCab)
      const wallet = new ethers.Wallet(envVars.privateKey || "", provider)
      if (!wallet) {
        toast.error("Signer not available")
        return
      }
      const contract = getKaleidoContract(wallet)
      try {
        await contract.registerUpliner.staticCall(upliner, address)
        const transaction = await contract.registerUpliner(upliner, address)
        const receipt = transaction.wait()
        console.log("Upliner Successfully registered Transaction receipt:", receipt)
      } catch (error) {
        const err = await errorDecoder.decode(error)
        console.error("Error registering upliner:", err)
      }
    },
    [activeChain, activeAccount, client],
  )

  return {
    registerUpliner,
  }
}
