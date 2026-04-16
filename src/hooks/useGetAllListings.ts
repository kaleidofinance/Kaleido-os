// "use client"
// import { getKaleidoContract } from "@/config/contracts"
// import { readOnlyProvider } from "@/config/provider"
// import { LoanListing } from "@/constants/types"
// import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals"
// import { ethers } from "ethers"
// import { useEffect, useState } from "react"
// import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
// import useFetchAllListings from "./useFetchAllListings"

// const useGetAllListings = () => {
//   const [listings, setListings] = useState<{
//     loadings: boolean
//     data: LoanListing[] | undefined
//   }>({
//     loadings: true,
//     data: [],
//   })

//   const [filteredListings, setFilteredListings] = useState<{
//     loadings: boolean
//     data: LoanListing[] | undefined
//   }>({
//     loadings: true,
//     data: [],
//   })

//   const [myLendOrder, setMyLendOrder] = useState<{
//     loadings: boolean
//     data: LoanListing[] | undefined
//   }>({
//     loadings: true,
//     data: [],
//   })

//   // Add state for borrow-related data
//   const [borrowLoading, setBorrowLoading] = useState<boolean>(true)
//   const [listingData2, setListingData2] = useState<LoanListing[] | undefined>([])

//   // useFetchAllListings()
//   const activeAccount = useActiveAccount()
//   const address = activeAccount?.address

//   useEffect(() => {
//     ;(async () => {
//       const contract = getKaleidoContract(readOnlyProvider)
//       let _index = 1
//       const fetchedListings: LoanListing[] = []

//       while (true) {
//         try {
//           // Get the raw data first
//           const rawData = await contract.getLoanListing(1)
//           // const userLoanListing = await contract.getUserLoanListing(_index)
//           // console.log("rawData", rawData)

//           // Check if we have a valid listing
//           if (rawData && rawData.author !== ethers.ZeroAddress) {
//             const structuredListing: LoanListing = {
//               listingId: Number(rawData.listingId),
//               author: rawData.author,
//               tokenAddress: rawData.tokenAddress,
//               amount: ethers.formatEther(rawData.amount),
//               min_amount: ethers.formatUnits(rawData.min_amount, getTokenDecimals(rawData.tokenAddress)),
//               max_amount: ethers.formatUnits(rawData.max_amount, getTokenDecimals(rawData.tokenAddress)),
//               returnDate: Number(rawData.returnDate),
//               interest: Number(rawData.interest),
//               status: rawData.listingStatus === BigInt(0) ? "OPEN" : "CLOSED",
//             }

//             fetchedListings.push(structuredListing)
//           } else {
//             break // No valid listing, exit loop
//           }
//           _index += 1
//         } catch (error: any) {
//           // Handle specific errors here
//           if (error.message && error.message.includes("Protocol__IdNotExist")) {
//             // console.log("Listing ID does not exist, stopping.")
//             break // Stop if listing ID doesn't exist
//           }
//           // console.error("Error fetching loan listings:", error)
//           setListings((prev) => ({ ...prev, loadings: false }))
//           setBorrowLoading(false)
//           break
//         }
//       }
//       // console.log("Fetched Listings", fetchedListings)
//       // Get current Unix timestamp
//       const currentTime = Math.floor(Date.now() / 1000)

//       // Filter listings based on return date and status
//       const filtered = fetchedListings.filter(
//         (listing) => listing.returnDate > currentTime && listing.status === "OPEN",
//       )

//       // Filter listings for the current user
//       const myOrders = fetchedListings.filter((listing) => listing.author.toLowerCase() === address?.toLowerCase())

//       setListings({ loadings: false, data: fetchedListings })
//       setFilteredListings({ loadings: false, data: filtered })
//       setMyLendOrder({ loadings: false, data: myOrders })
//       setListingData2(fetchedListings) // Assign to listingData2
//       setBorrowLoading(false) // Stop loading
//     })()
//   }, [address])

//   return { borrowLoading, listingData2, listings, filteredListings, myLendOrder }
// }

// export default useGetAllListings
