import { getKaleidoContract } from "@/config/contracts"
import { wssProvider } from "@/config/provider"
import { useEffect, useState } from "react"
import { useActiveAccount } from "thirdweb/react"

const useListingsEvent = () => {
  const activeAccount = useActiveAccount()
  const address = activeAccount?.address
  const [bn, setBn] = useState(0)
  const contract = getKaleidoContract(wssProvider)
  const createLoanListingFilter = contract.filters.LoanListingCreated(address, null, null, null)
  const serviceRequestFilter = contract.filters.RequestServiced(null, address, null, null)

  return useEffect(() => {
    contract.on(createLoanListingFilter, (e) => {
      // console.log("Create loan listing event", e)
      setBn(e.log.blockNumber)
    })

    contract.on(serviceRequestFilter, (e) => {
      // console.log("Service request event", e)
      setBn(e.log.blockNumber)
    })
  }, [contract, createLoanListingFilter, serviceRequestFilter])
}

export default useListingsEvent
