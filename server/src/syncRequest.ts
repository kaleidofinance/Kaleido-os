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

const SYNC_INTERVAL = 60 * 1000

// TypeScript interfaces
interface SyncStats {
  total: number
  found: number
  saved: number
  skipped: number
  startId: number
  maxId: number
  duration: number
  errors: number
  upToDate: boolean
}

interface SyncResult {
  requests: any[]
  skippedIds: number[]
  stats: SyncStats
}

// Get the highest requestId already saved in database
const getLastSavedRequestId = async (): Promise<number> => {
  try {
    const { data, error } = await supabase
      .from("kaleido_requests")
      .select("requestId")
      .order("requestId", { ascending: false })
      .limit(1)
      .single()
    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows found
      throw error
    }
    const lastId = data?.requestId || 0
    console.log(`Last saved request ID in database: ${lastId}`)
    return lastId
  } catch (error: any) {
    console.log("Error getting last saved request ID:", error.message)
    return 0 // Start from beginning if error
  }
}

// Save requests to Supabase database using upsert (same as listings)
const saveRequestsToDatabase = async (requests: any[], batchNumber: number = 1) => {
  if (requests.length === 0) {
    console.log("No requests to save")
    return { saved: 0, errors: [] }
  }
  console.log(`💾 Saving batch ${batchNumber} to Supabase: ${requests.length} requests`)
  try {
    const { data, error } = await supabase.from("kaleido_requests").upsert(requests, {
      onConflict: "requestId",
      ignoreDuplicates: false,
    })
    if (error) {
      console.error(`❌ Supabase upsert error for batch ${batchNumber}:`, error)
      return { saved: 0, errors: [error] }
    }
    console.log(`✅ Saved ${requests.length} requests to Supabase`)
    return { saved: requests.length, errors: [] }
  } catch (error: any) {
    console.error(`❌ Database save exception for batch ${batchNumber}:`, error)
    return { saved: 0, errors: [error] }
  }
}

// Transform blockchain request data to database format
const transformRequestData = (rawRequest: any, requestId: number) => {
  try {
    return {
      listingId: Number(rawRequest[0]),
      requestId: Number(requestId), // Use the ID from the loop
      author: String(rawRequest[2]),
      amount: String(rawRequest[3]),
      interest: String(rawRequest[4]),
      totalRepayment: String(rawRequest[5]),
      returnDate: String(rawRequest[6]),
      lender: String(rawRequest[7]),
      tokenAddress: String(rawRequest[8]),
      collateralTokens: String(rawRequest[9]),
      status: rawRequest[10] === BigInt(0) ? "OPEN" : rawRequest[10] === BigInt(1) ? "SERVICED" : "CLOSED",
    }
  } catch (error: any) {
    console.error(`Error transforming request ${requestId}:`, error)
    return null
  }
}

const getAllRequest = async (): Promise<SyncResult> => {
  const contract = new ethers.Contract(contractAddress, diamondAbi, provider)

  // Get the starting point from database
  const lastSavedId = await getLastSavedRequestId()
  const startId = lastSavedId + 1
  console.log(`Starting sync from request ID: ${startId}`)

  // Find the maximum request ID on blockchain
  console.log("Discovering the highest request ID on blockchain...")
  const maxId = await findMaxRequestId(contract, startId)

  if (maxId < startId) {
    console.log(`No new requests found. Database is up to date (last ID: ${lastSavedId})`)
    return {
      requests: [],
      skippedIds: [],
      stats: {
        total: 0,
        found: 0,
        saved: 0,
        skipped: 0,
        startId: startId,
        maxId: lastSavedId,
        duration: 0,
        errors: 0,
        upToDate: true,
      },
    }
  }

  console.log(`New requests found: ${startId} to ${maxId} (${maxId - startId + 1} requests)`)

  // Fetch and save new requests
  const result = await fetchAndSaveRequestsBatch(contract, startId, maxId)
  return result
}

// Binary search to find the maximum request ID efficiently
const findMaxRequestId = async (contract: any, startId: number = 1): Promise<number> => {
  let low = startId
  let high = startId + 1000 // Start with reasonable upper bound
  let maxFound = startId - 1 // Default to one less than start if none found

  // First, check if startId exists
  try {
    await contract.getRequest(startId)
    maxFound = startId
  } catch (error: any) {
    if (error.message.includes("Protocol__NotOwner")) {
      // No requests exist from startId onwards
      return startId - 1
    }
    throw error
  }

  // Find upper bound by doubling
  console.log("Finding upper bound...")
  while (high <= 100000) {
    try {
      await contract.getRequest(high)
      maxFound = high
      low = high
      high *= 2
      console.log(`Request ${maxFound} exists, trying ${high}...`)
    } catch (error: any) {
      if (error.message.includes("Protocol__NotOwner")) {
        break // Found upper bound
      }
      throw error
    }
  }

  // Binary search between low and high
  console.log(`Binary searching between ${low} and ${high}...`)
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    try {
      await contract.getRequest(mid)
      maxFound = mid
      low = mid + 1
      if (mid % 100 === 0) console.log(`Request ${mid} exists, searching higher...`)
    } catch (error: any) {
      if (error.message.includes("Protocol__NotOwner")) {
        high = mid - 1
        if (mid % 100 === 0) console.log(`Request ${mid} doesn't exist, searching lower...`)
      } else {
        throw error
      }
    }
  }
  return maxFound
}

// Fetch requests and save them in batches
const fetchAndSaveRequestsBatch = async (contract: any, startId: number, maxId: number): Promise<SyncResult> => {
  const FETCH_BATCH_SIZE = 50 // Blockchain fetch batch size
  const SAVE_BATCH_SIZE = 100 // Database save batch size
  const DELAY_BETWEEN_BATCHES = 150
  const totalRequests = maxId - startId + 1

  console.log(`Fetching and saving ${totalRequests} requests (${startId} to ${maxId})...`)

  const allRequests: any[] = []
  const skippedIds: number[] = []
  const saveErrors: any[] = []
  let totalSaved = 0
  const startTime = Date.now()

  // Temporary batch for database saves
  let pendingRequests: any[] = []
  let dbBatchNumber = 1

  for (let i = startId; i <= maxId; i += FETCH_BATCH_SIZE) {
    const batchEnd = Math.min(i + FETCH_BATCH_SIZE - 1, maxId)
    const fetchBatchNumber = Math.floor((i - startId) / FETCH_BATCH_SIZE) + 1
    const totalFetchBatches = Math.ceil(totalRequests / FETCH_BATCH_SIZE)

    console.log(`Fetch batch ${fetchBatchNumber}/${totalFetchBatches}: fetching requests ${i}-${batchEnd}`)

    // Create promises for current fetch batch
    const batchPromises = []
    for (let j = i; j <= batchEnd; j++) {
      batchPromises.push(
        contract
          .getRequest(j)
          .then((request: any) => ({ id: j, request, success: true }))
          .catch((error: any) => {
            if (error.message.includes("Protocol__NotOwner")) {
              return { id: j, request: null, success: false }
            }
            throw error
          }),
      )
    }

    try {
      const batchResults = await Promise.all(batchPromises)

      // Process and transform results
      batchResults.forEach((result) => {
        if (result.success) {
          const transformedRequest = transformRequestData(result.request, result.id)
          if (transformedRequest) {
            allRequests.push(transformedRequest)
            pendingRequests.push(transformedRequest)
          }
        } else {
          skippedIds.push(result.id)
        }
      })

      const successCount = batchResults.filter((r) => r.success).length
      console.log(`Fetch batch ${fetchBatchNumber} completed: ${successCount}/${batchEnd - i + 1} requests found`)

      // Save to database when we have enough requests or at the end
      if (pendingRequests.length >= SAVE_BATCH_SIZE || batchEnd === maxId) {
        const saveResult = await saveRequestsToDatabase(pendingRequests, dbBatchNumber)
        totalSaved += saveResult.saved
        saveErrors.push(...saveResult.errors)
        pendingRequests = [] // Clear pending requests
        dbBatchNumber++
      }

      // Delay between fetch batches
      if (batchEnd < maxId) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES))
      }
    } catch (batchError: any) {
      console.log(`Fetch batch ${fetchBatchNumber} failed:`, batchError.message)
      saveErrors.push(batchError)
    }
  }

  const endTime = Date.now()

  console.log(`\n=== SYNC COMPLETE ===`)
  console.log(`Total time: ${(endTime - startTime) / 1000}s`)
  console.log(`Requests found: ${allRequests.length}/${totalRequests}`)
  console.log(`Requests saved to database: ${totalSaved}`)
  console.log(`Skipped IDs (gaps): ${skippedIds.length}`)
  console.log(`Database errors: ${saveErrors.length}`)

  if (skippedIds.length > 0 && skippedIds.length <= 20) {
    console.log(`Skipped IDs: ${skippedIds.join(", ")}`)
  } else if (skippedIds.length > 20) {
    console.log(`First 20 skipped IDs: ${skippedIds.slice(0, 20).join(", ")}...`)
  }

  if (saveErrors.length > 0) {
    console.log(`Database save errors: ${saveErrors.length}`)
    saveErrors.slice(0, 3).forEach((error, index) => {
      console.log(`Error ${index + 1}:`, error.message || error)
    })
  }

  return {
    requests: allRequests,
    skippedIds: skippedIds,
    stats: {
      total: totalRequests,
      found: allRequests.length,
      saved: totalSaved,
      skipped: skippedIds.length,
      startId: startId,
      maxId: maxId,
      duration: endTime - startTime,
      errors: saveErrors.length,
      upToDate: false,
    },
  }
}

// Main service loop
const runRequestsService = async (): Promise<void> => {
  console.log("🚀 Starting Kaleido Requests Sync Service")
  console.log(`⏰ Sync interval: ${SYNC_INTERVAL / 1000} seconds`)

  let runCount = 0

  while (true) {
    try {
      runCount++
      const timestamp = new Date().toISOString()
      console.log(`\n🔄 === SYNC RUN #${runCount} at ${timestamp} ===`)

      const result = await getAllRequest()

      if (result.stats.upToDate) {
        console.log("✅ Database is up to date - no new requests to process")
      } else {
        console.log("\n📊 Final Summary:")
        console.log(`- Start ID: ${result.stats.startId}`)
        console.log(`- Max ID: ${result.stats.maxId}`)
        console.log(`- New requests found: ${result.stats.found}`)
        console.log(`- Successfully saved: ${result.stats.saved}`)
        console.log(`- Skipped (gaps): ${result.stats.skipped}`)
        console.log(`- Errors: ${result.stats.errors}`)
        console.log(`- Duration: ${(result.stats.duration / 1000).toFixed(2)}s`)
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
runRequestsService().catch((error) => {
  console.error("💥 Service startup failed:", error)
  process.exit(1)
})
