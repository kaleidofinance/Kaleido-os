import { supabase } from "./db/supabase"
import dotenv from "dotenv"
import { ethers } from "ethers"
import { getTokenDecimals } from "./utils/helper"
import { envSchema } from "../config/envSchema.js"
import { diamondAbi } from "../abi/ProtocolFacet.js"

dotenv.config()

const parsedEnv = envSchema.safeParse(process.env)
if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:", parsedEnv.error.format())
  process.exit(1)
}

const CONFIG = parsedEnv.data
const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL)
const contractAddress = CONFIG.DIAMOND_CONTRACT_ADDRESS
const contract = new ethers.Contract(contractAddress, diamondAbi, provider)

const BATCH_SIZE = 100
const SYNC_INTERVAL = 60 * 1000 // 5 minute in milliseconds

const fetchAndStoreListings = async () => {
  console.log("🔄 Starting listings sync process...")

  try {
    // Get the maximum listing ID from subgraph
    console.log("📊 Getting maximum listing ID from subgraph...")
    const maxListingId = await getMaxListingIdFromContract()
    if (maxListingId === 0) throw Error("Error MaxID can not be 0")

    // Get the last processed listing ID from database
    console.log("🔍 Finding last processed listing ID...")
    const { data: lastListing, error: lastError } = await supabase
      .from("kaleido_listings")
      .select("listingId")
      .order("listingId", { ascending: false })
      .limit(1)
      .single()

    let startId = 2859 // Default start if no listings in DB

    if (lastError) {
      if (lastError.code === "PGRST116") {
        // No rows found - start from beginning
        console.log("📋 No existing listings found, starting from beginning")
      } else {
        console.error("❌ Error getting last listing:", lastError)
      }
    } else if (lastListing) {
      startId = lastListing.listingId + 1 // Start from next ID after last processed
      console.log(`📋 Last processed listing: ${lastListing.listingId}, starting from: ${startId}`)
    }

    // Check if we need to process anything
    if (startId > maxListingId) {
      console.log(`✅ Already up to date! Last processed: ${startId - 1}, Latest: ${maxListingId}`)
      return { processed: 0, upToDate: true }
    }

    // Generate range of listing IDs from startId to max
    const allListingIds = Array.from({ length: maxListingId - startId + 1 }, (_, i) => startId + i)

    console.log(
      `📋 Processing listings from ${startId} to ${maxListingId} (${allListingIds.length} total new listings)`,
    )

    if (allListingIds.length === 0) {
      console.log("✅ No listings to process")
      return { processed: 0, upToDate: true }
    }

    // Process in batches using ethers.js
    const allListings = []
    const decimalsCache: Record<string, number> = {}

    for (let i = 0; i < allListingIds.length; i += BATCH_SIZE) {
      const batchIds = allListingIds.slice(i, i + BATCH_SIZE)
      console.log(
        `🔄 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allListingIds.length / BATCH_SIZE)} (${batchIds.length} items)`,
      )

      // Create batch of promises using ethers.js
      const batchPromises = batchIds.map(async (listingId) => {
        try {
          console.log(`🔍 Fetching listing ${listingId}...`)

          // Direct contract call with ethers.js
          const rawData = await contract.getLoanListing(listingId)

          // Check if listing exists
          if (!rawData || rawData.author === ethers.ZeroAddress) {
            console.log(`⚠️ Listing ${listingId} has zero address, skipping`)
            return null
          }

          // Get token decimals
          let decimals = decimalsCache[rawData.tokenAddress]
          if (!decimals) {
            console.log(`🔍 Getting decimals for token ${rawData.tokenAddress}`)
            decimals = await getTokenDecimals(rawData.tokenAddress)
            decimalsCache[rawData.tokenAddress] = decimals
          }

          const listing = {
            listingId: Number(rawData.listingId),
            sender: rawData.author,
            tokenAddress: rawData.tokenAddress,
            amount: rawData.amount.toString(),
            minAmount: rawData.min_amount.toString(),
            maxAmount: rawData.max_amount.toString(),
            returnDate: rawData.returnDate.toString(),
            interest: rawData.interest.toString(),
            status: rawData.listingStatus === BigInt(0) ? "OPEN" : "CLOSED",
          }

          console.log(`✅ Successfully processed listing ${listingId}`)
          return listing
        } catch (error: any) {
          console.error(`❌ Error fetching listing ${listingId}:`, error.message)
          return null
        }
      })

      // Execute batch with Promise.all
      try {
        console.log(`⚡ Executing batch of ${batchPromises.length} calls...`)
        const batchResults = await Promise.all(batchPromises)

        // Filter out null results
        const validListings = batchResults.filter((listing) => listing !== null)
        allListings.push(...validListings)

        console.log(`✅ Batch complete: ${validListings.length}/${batchIds.length} successful`)

        // Optional: Add delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < allListingIds.length) {
          console.log("⏸️ Waiting 1 second before next batch...")
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      } catch (error: any) {
        console.error(`❌ Batch processing error:`, error)
        // Continue with next batch
      }
    }

    console.log(`✅ Processed ${allListings.length} total listings.`)

    // Insert or Upsert into Supabase in batches
    if (allListings.length > 0) {
      const SUPABASE_BATCH_SIZE = 100 // Supabase batch limit

      for (let i = 0; i < allListings.length; i += SUPABASE_BATCH_SIZE) {
        const batch = allListings.slice(i, i + SUPABASE_BATCH_SIZE)

        console.log(`💾 Saving batch to Supabase: ${batch.length} listings`)

        const { data, error } = await supabase.from("kaleido_listings").upsert(batch, {
          onConflict: "listingId",
          ignoreDuplicates: false,
        })

        if (error) {
          console.error("❌ Supabase upsert error:", error)
        } else {
          console.log(`✅ Saved ${batch.length} listings to Supabase`)
        }
      }

      console.log(`🎉 Successfully synced ${allListings.length} listings to database!`)
    }

    console.log(`🎊 Sync complete! Processed listings ${startId} to ${maxListingId}`)
    return { processed: allListings.length, upToDate: false }
  } catch (error: any) {
    console.error("❌ Main process error:", error)
    throw error
  }
}

// async function getMaxListingIdFromSubgraph(): Promise<number> {
//   const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/116914/kaleido-finance/v1.0.1"

//   let lastId = "0"
//   let hasMore = true
//   let pageCount = 0
//   let maxListingId = 0

//   while (hasMore) {
//     pageCount++
//     console.log(`📄 Fetching page ${pageCount}...`)

//     const query = `{
//       loanListingCreateds(
//         first: 1000,
//         where: { listingId_gt: "${lastId}" },
//         orderBy: listingId,
//         orderDirection: asc
//       ) {
//         listingId
//       }
//     }`

//     try {
//       const response = await fetch(SUBGRAPH_URL, {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           Accept: "application/json",
//         },
//         body: JSON.stringify({ query }),
//       })

//       if (!response.ok) {
//         throw new Error(`HTTP error! status: ${response.status}`)
//       }

//       const result = await response.json()

//       if (result.errors) {
//         console.error("GraphQL errors:", result.errors)
//         throw new Error(`GraphQL error: ${result.errors[0].message}`)
//       }

//       const listings = result.data.loanListingCreateds

//       if (listings.length === 0) {
//         hasMore = false
//         console.log(`📄 Reached end of data at page ${pageCount}`)
//       } else {
//         // Update lastId for pagination
//         lastId = listings[listings.length - 1].listingId

//         // Convert to numbers and find max in this page
//         const numericListingIds = listings.map((listing: any) => parseInt(listing.listingId))
//         const maxInPage = Math.max(...numericListingIds)

//         if (maxInPage > maxListingId) {
//           maxListingId = maxInPage
//         }

//         console.log(`📄 Page ${pageCount}: Max listingId so far is ${maxListingId}`)

//         // Small delay to avoid rate-limiting
//         await new Promise((resolve) => setTimeout(resolve, 500))
//       }
//     } catch (error: any) {
//       console.error(`❌ Error fetching page ${pageCount}:`, error)
//       throw error
//     }
//   }

//   console.log(`✅ The maximum listingId from subgraph is: ${maxListingId}`)
//   return maxListingId
// }

async function getMaxListingIdFromContract(): Promise<number> {
  try {
    const maxId = await contract.getListingId()
    return Number(maxId)
  } catch (error) {
    console.error("Error getting maxId:", error)
    return 0
  }
}
// Main service loop
const runListingsService = async () => {
  console.log("🚀 Starting Kaleido Listings Sync Service")
  console.log(`⏰ Sync interval: ${SYNC_INTERVAL / 1000} seconds`)

  let runCount = 0

  while (true) {
    try {
      runCount++
      const timestamp = new Date().toISOString()
      console.log(`\n🔄 === SYNC RUN #${runCount} at ${timestamp} ===`)

      const result = await fetchAndStoreListings()

      if (result.upToDate) {
        console.log("✅ Database is up to date - no new listings to process")
      } else {
        console.log(`✅ Successfully processed ${result.processed} new listings`)
      }

      console.log(`⏰ Next sync in ${SYNC_INTERVAL / 1000} seconds...`)
    } catch (error: any) {
      console.error("💥 Sync error:", error)
      console.log("🔄 Will retry in next interval...")
    }

    // Wait for the specified interval
    await new Promise((resolve) => setTimeout(resolve, SYNC_INTERVAL))
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, shutting down gracefully...")
  process.exit(0)
})

process.on("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...")
  process.exit(0)
})

// Start the service
runListingsService().catch((error) => {
  console.error("💥 Service startup failed:", error)
  process.exit(1)
})

// async function getMaxListingIdFromSubgraph(): Promise<number> {
//   const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/116914/kaleido-finance/v1.0.1"

//   // Single query to get the highest listingId
//   const query = `{
//     loanListingCreateds(
//       first: 1,
//       orderBy: listingId,
//       orderDirection: desc
//     ) {
//       listingId
//     }
//   }`

//   try {
//     console.log("📊 Getting maximum listing ID from subgraph...")

//     const response = await fetch(SUBGRAPH_URL, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         Accept: "application/json",
//       },
//       body: JSON.stringify({ query }),
//     })

//     if (!response.ok) {
//       throw new Error(`HTTP error! status: ${response.status}`)
//     }

//     const result = await response.json()

//     if (result.errors) {
//       console.error("GraphQL errors:", result.errors)
//       throw new Error(`GraphQL error: ${result.errors[0].message}`)
//     }

//     const listings = result.data.loanListingCreateds

//     if (listings.length === 0) {
//       console.log("⚠️ No listings found in subgraph")
//       return 0
//     }

//     const maxListingId = parseInt(listings[0].listingId)
//     console.log(`✅ Maximum listingId from subgraph: ${maxListingId}`)

//     return maxListingId
//   } catch (error: any) {
//     console.error("❌ Error fetching max listing ID:", error)
//     throw error
//   }
// }
