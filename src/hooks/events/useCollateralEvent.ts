import { useEffect, useState } from "react"
import { getKaleidoContract } from "@/config/contracts"
import { wssProvider } from "@/config/provider"
import { useActiveAccount } from "thirdweb/react"

const useCollateralEvent = () => {
  const activeAccount = useActiveAccount()
  const address = activeAccount?.address
  const [blockNumber, setBlockNumber] = useState<number | null>(null)
  const contract = getKaleidoContract(wssProvider)

  useEffect(() => {
    if (!address) return

    const depositFilter = contract.filters.CollateralDeposited(address, null, null)
    const withdrawFilter = contract.filters.CollateralWithdrawn(address, null, null)

    const onDeposit = (userAddress: string, arg1: any, arg2: any, event: any) => {
      // console.log("Deposit event", event)
      setBlockNumber(event.blockNumber)
    }

    const onWithdraw = (userAddress: string, arg1: any, arg2: any, event: any) => {
      // console.log("Withdraw event", event)
      setBlockNumber(event.blockNumber)
    }

    contract.on(depositFilter, onDeposit)
    contract.on(withdrawFilter, onWithdraw)

    // Cleanup listeners on unmount or address change
    return () => {
      contract.off(depositFilter, onDeposit)
      contract.off(withdrawFilter, onWithdraw)
    }
  }, [contract, address])

  return blockNumber
}

export default useCollateralEvent
