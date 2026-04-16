// "use client"
// import { useEffect, useState, useCallback } from "react"
// import { ethers } from "ethers"
// import { getLendbitContract } from "@/config/contracts"
// import { readOnlyProvider } from "@/config/provider"
// import { Request } from "@/constants/types"
// import { useActiveAccount } from "thirdweb/react"

// const useGetMyRequests = () => {
//   const [allRequests, setAllRequests] = useState<Request[]>([])
//   const [filteredRequests, setFilteredRequests] = useState<Request[]>([])
//   const [loading, setLoading] = useState<boolean>(true)
//   const [reqNo, setReqNo] = useState<string | null>(null)
//   const activeAccount = useActiveAccount()
//   const address = activeAccount?.address

//   const fetchRequests = useCallback(async (userAddress?: string) => {
//     setLoading(true)
//     const contract = getLendbitContract(readOnlyProvider)

//     const requests: Request[] = []
//     let index = 1

//     while (true) {
//       try {
//         const req = await contract.getRequest(index)
//         if (Number(req[0]) === 0) break

//         const request: Request = {
//           requestId: Number(req[0]),
//           author: req[1],
//           amount: ethers.formatEther(req[2]),
//           interest: Number(req[3]),
//           totalRepayment: ethers.formatEther(req[4]),
//           returnDate: Number(req[5]),
//           lender: req[6],
//           tokenAddress: req[7],
//           status: req[9] === BigInt(0) ? "OPEN" : req[9] === BigInt(1) ? "SERVICED" : "CLOSED",
//         }

//         requests.push(request)
//         index += 1
//       } catch (err) {
//         // console.error(`Error fetching request at index ${index}`, err)
//         break
//       }
//     }

//     setAllRequests(requests)
//     if (requests[0]) {
//       setReqNo(requests[0].author)
//     }

//     // Filtering logic
//     const nowInSeconds = Math.floor(Date.now() / 1000)
//     const filtered = requests.filter((r) => {
//       const isOpen = r.status === "OPEN"
//       const isFuture = r.returnDate > nowInSeconds
//       const notAuthor = r.author.toLowerCase() !== (userAddress?.toLowerCase() ?? "")

//       // console.log(`Request ${r.requestId}:`);
//       // console.log(`  Status: ${r.status}, isOpen: ${isOpen}`);
//       // console.log(`  Return Date: ${r.returnDate}, nowInSeconds: ${nowInSeconds}, isFuture: ${isFuture}`);
//       // console.log(`  Author: ${r.author.toLowerCase()}, userAddress: ${userAddress?.toLowerCase() ?? ''}, notAuthor: ${notAuthor}`);

//       return isOpen && isFuture && notAuthor
//     })

//     // console.log("All requests", requests);
//     // console.log("Filtered requests", filtered);

//     setFilteredRequests(filtered)
//     setLoading(false)
//   }, [])

//   useEffect(() => {
//     if (address) {
//       fetchRequests(address)
//     }
//   }, [address, fetchRequests])

//   const myRequests = allRequests.filter((request) => request.author.toLowerCase() === address?.toLowerCase())

//   return {
//     lendLoading: loading,
//     filteredRequests,
//     allRequests,
//     myRequests,
//     reqNo,
//   }
// }

// // export default useGetAllRequests
