import { supabase } from "./db/supabase"
import dotenv from "dotenv"
import { ethers } from "ethers"
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
const contract = new ethers.Contract(CONFIG.DIAMOND_CONTRACT_ADDRESS, diamondAbi, provider)

const PAGE_SIZE = 1000 // Supabase page size limit
const SYNC_INTERVAL = 60 * 1000 // 60 seconds

async function fetchAllOpenListings() {
  const allListings = []
  let page = 0
  let hasMore = true

  console.log("📊 Fetching all OPEN listings from Supabase...")

  while (hasMore) {
    const { data, error } = await supabase
      .from("kaleido_listings")
      .select("listingId, status")
      .eq("status", "OPEN")
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (error) {
      console.error("❌ Supabase fetch error:", error)
      throw error
    }

    if (data.length === 0) {
      hasMore = false
    } else {
      console.log(`📦 Fetched batch ${page + 1}: ${data.length} listings`)
      allListings.push(...data)
      page++
    }
  }

  console.log(`✅ Total OPEN listings fetched: ${allListings.length}`)
  return allListings
}

async function monitorListingStatus() {
  console.log("🚀 Starting Listing Status Monitor Service")
  console.log(`⏰ Sync interval: ${SYNC_INTERVAL / 1000} seconds`)

  while (true) {
    try {
      console.log("\n🔄 Checking for listing status updates...")

      const listings = await fetchAllOpenListings()

      if (listings.length === 0) {
        console.log("✅ No open listings to monitor")
      } else {
        console.log(`📋 Monitoring ${listings.length} open listings`)

        // Process in BATCHES to avoid rate-limits
        const BATCH_SIZE = 100
        for (let i = 0; i < listings.length; i += BATCH_SIZE) {
          const batch = listings.slice(i, i + BATCH_SIZE)

          await Promise.all(
            batch.map(async (listing) => {
              const listingId = listing.listingId
              try {
                const onChainListing = await contract.getLoanListing(listingId)
                const isClosed = onChainListing.listingStatus !== BigInt(0)

                if (isClosed) {
                  console.log(`❗ Listing ${listingId} has been CLOSED on-chain, updating DB...`)
                  const { error: updateError } = await supabase
                    .from("kaleido_listings")
                    .update({ status: "CLOSED" })
                    .eq("listingId", listingId)

                  if (updateError) {
                    console.error(`❌ Failed to update listing ${listingId} in DB:`, updateError)
                  } else {
                    console.log(`✅ Listing ${listingId} marked as CLOSED in DB`)
                  }
                }
              } catch (err: any) {
                console.error(`❌ Error fetching listing ${listingId}:`, err.message)
              }
            }),
          )

          console.log(`✅ Batch processed: ${batch.length} listings`)

          // Delay between batches to avoid rate limiting
          if (i + BATCH_SIZE < listings.length) {
            console.log("⏸️ Waiting 1 second before next batch...")
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }
        }
      }

      console.log(`⏸️ Waiting ${SYNC_INTERVAL / 1000} seconds before next check...`)
    } catch (err) {
      console.error("💥 Unexpected monitor loop error:", err)
    }

    await new Promise((resolve) => setTimeout(resolve, SYNC_INTERVAL))
  }
}

monitorListingStatus().catch((err) => {
  console.error("💥 Monitor service failed to start:", err)
  process.exit(1)
})
