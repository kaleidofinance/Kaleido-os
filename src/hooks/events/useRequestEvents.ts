import { getKaleidoContract } from "@/config/contracts"
import { wssProvider } from "@/config/provider"
import { useEffect, useState } from "react"
import { useActiveAccount } from "thirdweb/react"
import { 
  sendNewBorrowRequestNotification, 
  sendLoanFilledNotification,
  sendLoanRepaidNotification,
  sendLiquidationNotification 
} from "@/utils/notificationService"

const useRequestEvent = () => {
  const activeAccount = useActiveAccount()

  const address = activeAccount?.address
  const [bn, setBn] = useState(0)
  const contract = getKaleidoContract(wssProvider)
  const createRequestFilter = contract.filters.RequestCreated(address, null, null, null)
  const serviceRequestFilter = contract.filters.RequestServiced(null, address, null, null)
  const repayLoanFilter = contract.filters.LoanRepayment(address, null, null)
  const liquidateEvent = contract.filters.RequestLiquidated(null, address, null)

  return useEffect(() => {
    contract.on(createRequestFilter, (e) => {
      // console.log("Create request event", e)
      setBn(e.log.blockNumber)
      // Notify user if someone else created a request for them
      if (e.args && e.args[0] && e.args[0].toLowerCase() !== address?.toLowerCase() && address) {
        sendNewBorrowRequestNotification(address);
      }
    })

    contract.on(serviceRequestFilter, (e) => {
      // console.log("Service request event", e)
      setBn(e.log.blockNumber)
      // Notify user if their request was serviced by someone else
      if (e.args && e.args[1] && e.args[1].toLowerCase() !== address?.toLowerCase() && address) {
        sendLoanFilledNotification(address);
      }
    })

    contract.on(repayLoanFilter, (e) => {
      // console.log("Loan repayment event", e)
      setBn(e.log.blockNumber)
      // Notify user if their loan was repaid by someone else
      if (e.args && e.args[0] && e.args[0].toLowerCase() !== address?.toLowerCase() && address) {
        sendLoanRepaidNotification(address);
      }
    })

    contract.on(liquidateEvent, (e) => {
      // console.log("Liquidate request event", e)
      setBn(e.log.blockNumber)
      // Notify user if their request was liquidated by someone else
      if (e.args && e.args[1] && e.args[1].toLowerCase() !== address?.toLowerCase() && address) {
        sendLiquidationNotification(address);
      }
    })
  }, [contract, createRequestFilter, serviceRequestFilter, repayLoanFilter, liquidateEvent])
}

export default useRequestEvent
