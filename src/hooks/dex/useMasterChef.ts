import { useCallback } from "react"
import { getKaleidoMasterChefContract } from "@/config/contracts"
import { ethers } from "ethers"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { client } from "@/config/client"

export const useMasterChef = () => {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()

  const getContract = useCallback(
    async (withSigner = false) => {
      if (withSigner) {
        if (!activeAccount || !activeChain) throw new Error("Wallet not connected")
        const signer = await ethers6Adapter.signer.toEthers({
          client,
          chain: activeChain,
          account: activeAccount,
        })
        return getKaleidoMasterChefContract(signer)
      }
      
      // For read-only, we can try to get a provider from the chain or adapter
      // Or just fall back to a public provider if needed.
      // For now, let's try to use the signer if available, or just error if strict?
      // Actually, for read-only calls (getPoolInfo), we ideally want a provider.
      // Ethers6Adapter provider:
      if (activeChain) {
          const provider = ethers6Adapter.provider.toEthers({ client, chain: activeChain });
          return getKaleidoMasterChefContract(provider);
      }
      throw new Error("No provider available")
    },
    [activeAccount, activeChain]
  )

  const deposit = useCallback(
    async (pid: number, amount: string) => {
      const contract = await getContract(true)
      const formattedAmount = ethers.parseEther(amount)
      const tx = await contract.deposit(pid, formattedAmount)
      await tx.wait()
      return tx
    },
    [getContract]
  )

  const withdraw = useCallback(
    async (pid: number, amount: string) => {
      const contract = await getContract(true)
      const formattedAmount = ethers.parseEther(amount)
      const tx = await contract.withdraw(pid, formattedAmount)
      await tx.wait()
      return tx
    },
    [getContract]
  )

  const harvest = useCallback(
    async (pid: number) => {
      const contract = await getContract(true)
      // Deposit 0 to harvest
      const tx = await contract.deposit(pid, 0)
      await tx.wait()
      return tx
    },
    [getContract]
  )

  const getPendingKld = useCallback(
    async (pid: number, userAddress: string) => {
      try {
        const contract = await getContract(false)
        const pending = await contract.pendingKld(pid, userAddress)
        return ethers.formatEther(pending)
      } catch (error) {
        console.error("Error fetching pending KLD:", error)
        return "0"
      }
    },
    [getContract]
  )

  const getUserInfo = useCallback(
    async (pid: number, userAddress: string) => {
      try {
        const contract = await getContract(false)
        const info = await contract.userInfo(pid, userAddress)
        return {
          amount: ethers.formatEther(info.amount),
          rewardDebt: ethers.formatEther(info.rewardDebt),
        }
      } catch (error) {
        console.error("Error fetching user info:", error)
        return { amount: "0", rewardDebt: "0" }
      }
    },
    [getContract]
  )

  const getPoolInfo = useCallback(
    async (pid: number) => {
      try {
        const contract = await getContract(false)
        const info = await contract.poolInfo(pid)
        return {
          lpToken: info.lpToken,
          allocPoint: Number(info.allocPoint),
          lastRewardBlock: Number(info.lastRewardBlock),
          accKldPerShare: ethers.formatEther(info.accKldPerShare),
        }
      } catch (error) {
        console.error("Error fetching pool info:", error)
        return null
      }
    },
    [getContract]
  )

  const getPoolLength = useCallback(async () => {
    try {
      const contract = await getContract(false)
      const length = await contract.poolLength()
      return Number(length)
    } catch (error) {
      console.error("Error fetching pool length:", error)
      return 0
    }
  }, [getContract])

  const getTotalAllocPoint = useCallback(async () => {
    try {
      const contract = await getContract(false)
      const total = await contract.totalAllocPoint()
      return Number(total)
    } catch (error) {
      console.error("Error fetching total alloc point:", error)
      return 0
    }
  }, [getContract])

  const getKldPerBlock = useCallback(async () => {
    try {
      const contract = await getContract(false)
      const perBlock = await contract.kldPerBlock()
      return ethers.formatEther(perBlock)
    } catch (error) {
      console.error("Error fetching KLD per block:", error)
      return "0"
    }
  }, [getContract])

  return {
    deposit,
    withdraw,
    harvest,
    getPendingKld,
    getUserInfo,
    getPoolInfo,
    getPoolLength,
    getTotalAllocPoint,
    getKldPerBlock,
  }
}
