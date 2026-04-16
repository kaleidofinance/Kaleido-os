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
const contractAddress = CONFIG.DIAMOND_CONTRACT_ADDRESS

// Configuration
const MONITOR_INTERVAL = 30 * 1000 // 30 seconds - can be different from sync interval
const BATCH_SIZE = 200 // Number of requests to check per batch
const DELAY_BETWEEN_BATCHES = 200 // ms delay to avoid rate limiting
const MAX_RETRIES = 3 // Retry failed requests

// TypeScript interfaces
interface DatabaseRequest {
  requestId: number
  status: string
  listingId?: number
  author?: string
  amount?: string
  interest?: string
  totalRepayment?: string
  returnDate?: string
  lender?: string
  tokenAddress?: string
  collateralTokens?: string
}

interface StatusUpdate {
  requestId: number
  oldStatus: string
  newStatus: string
  onchainData: any
}

interface MonitorStats {
  totalRequests: number
  checkedRequests: number
  statusChanges: number
  errors: number
  duration: number
  skippedRequests: number
}

// Get all requests from database
const getAllDatabaseRequests = async (): Promise<DatabaseRequest[]> => {
  try {
    console.log("📊 Fetching all requests from database...")

    const PAGE_SIZE = 1000
    let allRequests: DatabaseRequest[] = []
    let from = 0
    let to = PAGE_SIZE - 1

    while (true) {
      const { data, error } = await supabase
        .from("kaleido_requests")
        .select("*")
        .order("requestId", { ascending: true })
        .range(from, to)

      if (error) {
        console.error("❌ Error fetching requests from database:", error)
        break
      }

      if (data && data.length > 0) {
        allRequests.push(...data)

        // If fetched less than PAGE_SIZE, it's the last page
        if (data.length < PAGE_SIZE) break

        // Move to next page
        from += PAGE_SIZE
        to += PAGE_SIZE
      } else {
        break
      }
    }

    console.log(`✅ Found ${allRequests.length} requests in database`)
    return allRequests
  } catch (error: any) {
    console.error("💥 Exception fetching database requests:", error.message)
    return []
  }
}

// Transform blockchain data to database format
const transformOnchainData = (rawRequest: any, requestId: number) => {
  try {
    return {
      listingId: Number(rawRequest[0]),
      requestId: Number(requestId),
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
    console.error(`❌ Error transforming onchain data for request ${requestId}:`, error)
    return null
  }
}

// Check a single request on-chain with retry logic
const checkRequestOnchain = async (contract: any, requestId: number, retries: number = 0): Promise<any | null> => {
  try {
    const onchainRequest = await contract.getRequest(requestId)
    return transformOnchainData(onchainRequest, requestId)
  } catch (error: any) {
    if (error.message.includes("Protocol__NotOwner") || error.message.includes("Request does not exist")) {
      // Request doesn't exist on-chain anymore - this could be normal
      console.log(`⚠️  Request ${requestId} not found on-chain (may have been removed)`)
      return null
    }

    if (retries < MAX_RETRIES) {
      console.log(`🔄 Retrying request ${requestId} (attempt ${retries + 1}/${MAX_RETRIES})`)
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retries + 1))) // Exponential backoff
      return checkRequestOnchain(contract, requestId, retries + 1)
    }

    console.error(`❌ Failed to check request ${requestId} after ${MAX_RETRIES} retries:`, error.message)
    throw error
  }
}

// Compare database request with onchain data
const compareRequestData = (dbRequest: DatabaseRequest, onchainData: any): StatusUpdate | null => {
  if (!onchainData) {
    // Request not found on-chain
    return null
  }

  // Check if status has changed
  if (dbRequest.status !== onchainData.status) {
    return {
      requestId: dbRequest.requestId,
      oldStatus: dbRequest.status,
      newStatus: onchainData.status,
      onchainData: onchainData,
    }
  }

  // You can add more comparisons here if needed (amount, lender, etc.)
  // For now, we only monitor status changes
  return null
}

// Update requests in database
const updateRequestsInDatabase = async (updates: StatusUpdate[]): Promise<{ updated: number; errors: any[] }> => {
  if (updates.length === 0) {
    return { updated: 0, errors: [] }
  }

  console.log(`💾 Updating ${updates.length} requests in database...`)

  try {
    // Prepare update data
    const updateData = updates.map((update) => update.onchainData)

    const { data, error } = await supabase.from("kaleido_requests").upsert(updateData, {
      onConflict: "requestId",
      ignoreDuplicates: false,
    })

    if (error) {
      console.error("❌ Database update error:", error)
      return { updated: 0, errors: [error] }
    }

    // Log individual status changes
    updates.forEach((update) => {
      console.log(`📝 Updated request ${update.requestId}: ${update.oldStatus} → ${update.newStatus}`)
    })

    console.log(`✅ Successfully updated ${updates.length} requests`)
    return { updated: updates.length, errors: [] }
  } catch (error: any) {
    console.error("💥 Database update exception:", error)
    return { updated: 0, errors: [error] }
  }
}

// Process a batch of requests
const processBatch = async (
  contract: any,
  batch: DatabaseRequest[],
  batchNumber: number,
  totalBatches: number,
): Promise<{ updates: StatusUpdate[]; errors: number }> => {
  console.log(`🔍 Processing batch ${batchNumber}/${totalBatches}: checking ${batch.length} requests`)

  const updates: StatusUpdate[] = []
  let errors = 0

  // Create promises for all requests in batch
  const batchPromises = batch.map(async (dbRequest) => {
    try {
      const onchainData = await checkRequestOnchain(contract, dbRequest.requestId)
      const statusUpdate = compareRequestData(dbRequest, onchainData)

      return {
        success: true,
        update: statusUpdate,
        error: null,
      }
    } catch (error: any) {
      return {
        success: false,
        update: null,
        error: error,
      }
    }
  })

  try {
    const results = await Promise.all(batchPromises)

    results.forEach((result, index) => {
      if (result.success) {
        if (result.update) {
          updates.push(result.update)
        }
      } else {
        console.error(`❌ Error checking request ${batch[index].requestId}:`, result.error?.message)
        errors++
      }
    })

    const changesFound = updates.length
    console.log(`✅ Batch ${batchNumber} complete: ${changesFound} status changes found, ${errors} errors`)

    return { updates, errors }
  } catch (batchError: any) {
    console.error(`💥 Batch ${batchNumber} failed completely:`, batchError.message)
    return { updates: [], errors: batch.length }
  }
}

// Main monitoring function
const monitorRequestStatus = async (): Promise<MonitorStats> => {
  const startTime = Date.now()
  console.log("\n🔍 === STARTING REQUEST STATUS MONITORING ===")

  // Initialize contract
  const contract = new ethers.Contract(contractAddress, diamondAbi, provider)

  // Get all requests from database
  const databaseRequests = await getAllDatabaseRequests()

  if (databaseRequests.length === 0) {
    console.log("ℹ️  No requests found in database to monitor")
    return {
      totalRequests: 0,
      checkedRequests: 0,
      statusChanges: 0,
      errors: 0,
      duration: Date.now() - startTime,
      skippedRequests: 0,
    }
  }

  const totalRequests = databaseRequests.length
  const totalBatches = Math.ceil(totalRequests / BATCH_SIZE)
  console.log(`📋 Monitoring ${totalRequests} requests in ${totalBatches} batches`)

  let totalUpdates: StatusUpdate[] = []
  let totalErrors = 0
  let checkedRequests = 0

  // Process requests in batches
  for (let i = 0; i < databaseRequests.length; i += BATCH_SIZE) {
    const batch = databaseRequests.slice(i, i + BATCH_SIZE)
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1

    const batchResult = await processBatch(contract, batch, batchNumber, totalBatches)

    totalUpdates.push(...batchResult.updates)
    totalErrors += batchResult.errors
    checkedRequests += batch.length - batchResult.errors

    // Update database if we have changes
    if (batchResult.updates.length > 0) {
      await updateRequestsInDatabase(batchResult.updates)
    }

    // Add delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < databaseRequests.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES))
    }
  }

  const endTime = Date.now()
  const duration = endTime - startTime

  console.log("\n📊 === MONITORING SUMMARY ===")
  console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`)
  console.log(`📋 Total requests: ${totalRequests}`)
  console.log(`✅ Successfully checked: ${checkedRequests}`)
  console.log(`🔄 Status changes found: ${totalUpdates.length}`)
  console.log(`❌ Errors: ${totalErrors}`)
  console.log(`⏭️  Skipped: ${totalRequests - checkedRequests}`)

  if (totalUpdates.length > 0) {
    console.log("\n📝 Status Changes:")
    totalUpdates.forEach((update) => {
      console.log(`  - Request ${update.requestId}: ${update.oldStatus} → ${update.newStatus}`)
    })
  }

  return {
    totalRequests,
    checkedRequests,
    statusChanges: totalUpdates.length,
    errors: totalErrors,
    duration,
    skippedRequests: totalRequests - checkedRequests,
  }
}

// Main service loop
const runStatusMonitorService = async (): Promise<void> => {
  console.log("🚀 Starting Kaleido Request Status Monitor Service")
  console.log(`⏰ Monitor interval: ${MONITOR_INTERVAL / 1000} seconds`)
  console.log(`📦 Batch size: ${BATCH_SIZE} requests per batch`)
  console.log(`⏳ Delay between batches: ${DELAY_BETWEEN_BATCHES}ms`)

  let runCount = 0

  while (true) {
    try {
      runCount++
      const timestamp = new Date().toISOString()
      console.log(`\n🔄 === MONITOR RUN #${runCount} at ${timestamp} ===`)

      const stats = await monitorRequestStatus()

      if (stats.statusChanges === 0 && stats.errors === 0) {
        console.log("✅ All requests are up to date - no changes detected")
      } else if (stats.statusChanges > 0) {
        console.log(`🔄 Updated ${stats.statusChanges} requests with status changes`)
      }

      if (stats.errors > 0) {
        console.log(`⚠️  ${stats.errors} errors encountered during monitoring`)
      }

      console.log(`⏰ Next monitoring run in ${MONITOR_INTERVAL / 1000} seconds...`)
    } catch (error: any) {
      console.error("💥 Monitor service error:", error)
      console.log("🔄 Will retry in next interval...")
    }

    // Wait for the specified interval
    await new Promise((resolve) => setTimeout(resolve, MONITOR_INTERVAL))
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, shutting down status monitor gracefully...")
  process.exit(0)
})

process.on("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM, shutting down status monitor gracefully...")
  process.exit(0)
})

// Export functions for potential use in other modules
export { monitorRequestStatus, getAllDatabaseRequests, checkRequestOnchain, updateRequestsInDatabase }

// Start the service if this file is run directly
const isMainModule = true

if (isMainModule) {
  console.log("🎯 Starting as main module...")
  runStatusMonitorService().catch((error) => {
    console.error("💥 Status monitor service startup failed:", error)
    process.exit(1)
  })
} else {
  console.log("📦 Loaded as module - use runStatusMonitorService() to start")
}
