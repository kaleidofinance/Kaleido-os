// "use client"

// import { useCallback, useEffect, useState } from "react"
// import { ethers } from "ethers"
// import { getKaleidoContract, getProtocolContract } from "@/config/contracts"
// import { readOnlyProvider } from "@/config/provider"
// import { Request } from "@/constants/types"
// import { useActiveAccount } from "thirdweb/react"

// const useGetAllRequests = () => {
//   const [allRequests, setAllRequests] = useState<Request[]>([])
//   const [filteredRequests, setFilteredRequests] = useState<Request[]>([])
//   const [loading, setLoading] = useState<boolean>(true)
//   const [firstAuthor, setFirstAuthor] = useState<string | null>(null)

//   const activeAccount = useActiveAccount()
//   const userAddress = activeAccount?.address

//   const fetchRequests = useCallback(async (walletAddress?: string) => {
//     setLoading(true)
//     try {
//       const contract = getProtocolContract(readOnlyProvider)
//       const requestsData = await contract.getAllRequest()
//       console.log("The requested Data:", requestsData)

//       // const mappedRequests = requestsData.map((req: any) => ({
//       //   requestId: Number(req[0]),
//       //   author: req[1],
//       //   amount: ethers.formatEther(req[2]),
//       //   interest: Number(req[3]),
//       //   totalRepayment: ethers.formatEther(req[4]),
//       //   returnDate: Number(req[5]),
//       //   lender: req[6],
//       //   tokenAddress: req[7],
//       //   status: req[9] === BigInt(0) ? "OPEN" : req[9] === BigInt(1) ? "SERVICED" : "CLOSED",
//       // })) as Request[]

//       const mappedRequests = requestsData.map((req: any) => ({
//         listingId: Number(req[0]),
//         requestId: Number(req[1]),
//         author: req[2],
//         amount: ethers.formatEther(req[3]),
//         interest: Number(req[4]),
//         totalRepayment: ethers.formatEther(req[5]),
//         returnDate: Number(req[6]),
//         lender: req[7],
//         tokenAddress: req[8],
//         collateralTokens: req[9],
//         status: req[10] === BigInt(0) ? "OPEN" : req[10] === BigInt(1) ? "SERVICED" : "CLOSED",
//       })) as Request[]

//       console.log("This is the Data to be tested:", requestsData)
//       setAllRequests(mappedRequests)
//       setFirstAuthor(mappedRequests[0]?.author ?? null)

//       const now = Math.floor(Date.now() / 1000)
//       const filtered = mappedRequests.filter(
//         (r) =>
//           r.status === "OPEN" && r.returnDate > now && r.author.toLowerCase() !== (walletAddress?.toLowerCase() ?? ""),
//       )
//       setFilteredRequests(filtered)
//     } catch (error) {
//       console.error("Error fetching requests:", error)
//       setAllRequests([])
//       setFilteredRequests([])
//     } finally {
//       setLoading(false)
//     }
//   }, [])

//   useEffect(() => {
//     fetchRequests(userAddress)
//   }, [userAddress, fetchRequests])

//   const myRequests = allRequests.filter((r) => userAddress && r.author.toLowerCase() === userAddress.toLowerCase())

//   return {
//     lendLoading: loading,
//     filteredRequests,
//     allRequests,
//     myRequests,
//     firstAuthor,
//   }
// }

// export default useGetAllRequests
