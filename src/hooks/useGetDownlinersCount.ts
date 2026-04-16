import { getKaleidoContract } from "@/config/contracts"
import { readOnlyProvider } from "@/config/provider"
import { useEffect } from "react"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"

export const useGetDownlinersCount = () => {
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const address = activeAccount?.address

  useEffect(() => {
    if (!activeChain || !address) return
    getDownlinersCount()
  }, [activeChain, address])

  async function getDownlinersCount(): Promise<number | undefined> {
    try {
      const contract = getKaleidoContract(readOnlyProvider)
      const refCount = await contract.getDownlinersCount(address)
      console.log("Downliners count:", refCount)
      return Number(refCount)
    } catch (error) {
      console.error("Error fetching downliners count:", error)
    }
  }
}
