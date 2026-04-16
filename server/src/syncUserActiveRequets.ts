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
const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider)
const contractAddress = CONFIG.DIAMOND_CONTRACT_ADDRESS

// Contract instance with signer for transactions
const contract = new ethers.Contract(contractAddress, diamondAbi, wallet)

const SYNC_INTERVAL = 5 * 60 * 1000 // 5 minutes
const BATCH_SIZE = 15 // Reduced for better nonce management
const MAX_REQUESTS_PER_USER = 50
const CHUNK_SIZE = 25 // Size for chunking high-volume users
const HIGH_VOLUME_BATCH_SIZE = 5 // Smaller batches for high-volume users

// Nonce management
class NonceManager {
  private currentNonce: number | null = null
  private pendingNonces = new Set<number>()

  async getCurrentNonce(): Promise<number> {
    if (this.currentNonce === null) {
      this.currentNonce = await provider.getTransactionCount(wallet.address, "pending")
    }
    return this.currentNonce
  }

  async getNextNonce(): Promise<number> {
    const nonce = await this.getCurrentNonce()
    this.currentNonce = nonce + 1
    this.pendingNonces.add(nonce)
    return nonce
  }

  markNonceUsed(nonce: number) {
    this.pendingNonces.delete(nonce)
  }

  async refreshNonce() {
    this.currentNonce = await provider.getTransactionCount(wallet.address, "pending")
    this.pendingNonces.clear()
  }

  async waitForNonceGap(maxWaitMs = 30000) {
    const startTime = Date.now()
    while (this.pendingNonces.size > 10 && Date.now() - startTime < maxWaitMs) {
      console.log(`⏳ Waiting for pending transactions to complete (${this.pendingNonces.size} pending)...`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
      // Refresh nonce to check which transactions completed
      await this.refreshNonce()
    }
  }
}

const nonceManager = new NonceManager()

// Status enum mapping to match Solidity contract
enum ContractStatus {
  OPEN = 0,
  SERVICED = 1,
  CLOSED = 2,
}

// Helper function to convert string status to contract enum value
const getContractStatusValue = (status: string): number => {
  switch (status.toUpperCase()) {
    case "OPEN":
      return ContractStatus.OPEN
    case "SERVICED":
      return ContractStatus.SERVICED
    case "CLOSED":
      return ContractStatus.CLOSED
    default:
      console.warn(`Unknown status: ${status}, defaulting to SERVICED`)
      return ContractStatus.SERVICED
  }
}

// Helper function to validate status values
const validateStatusValue = (status: string): boolean => {
  const validStatuses = ["OPEN", "SERVICED", "CLOSED"]
  return validStatuses.includes(status.toUpperCase())
}

// TypeScript interfaces
export interface Request {
  listingId: number
  requestId: number
  author: string
  amount: string
  interest: number
  totalRepayment: string
  returnDate: number
  lender: string
  loanRequestAddr: string
  collateralTokens: string[]
  status: string
}

interface UserActiveRequests {
  author: string
  activeRequests: Request[]
  totalActive: number
  isHighVolume?: boolean // Flag for special handling
}

interface SyncStats {
  totalUsers: number
  processedUsers: number
  skippedUsers: number
  totalRequests: number
  successfulUpdates: number
  failedUpdates: number
  duration: number
  errors: string[]
  highVolumeUsersProcessed: number
}

// Enhanced retry mechanism with exponential backoff
const executeWithRetry = async <T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
  operationName = "operation",
): Promise<T> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries
      const isNonceError =
        error.code === "NONCE_EXPIRED" ||
        error.message?.includes("nonce") ||
        error.message?.includes("transaction underpriced")

      if (isNonceError && !isLastAttempt) {
        console.log(`⚠️ Nonce error on attempt ${attempt}/${maxRetries} for ${operationName}. Refreshing nonce...`)
        await nonceManager.refreshNonce()
        const delay = baseDelay * Math.pow(2, attempt - 1) // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      if (!isLastAttempt) {
        const delay = baseDelay * Math.pow(2, attempt - 1)
        console.log(`⚠️ Attempt ${attempt}/${maxRetries} failed for ${operationName}. Retrying in ${delay}ms...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      throw error
    }
  }
  throw new Error("Should not reach here")
}

// Helper function to parse collateral tokens from database
const parseCollateralTokens = (collateralTokens: any): string[] => {
  if (!collateralTokens) {
    return []
  }

  if (Array.isArray(collateralTokens)) {
    return collateralTokens.filter((token) => token && token.trim() !== "")
  }

  if (typeof collateralTokens === "string") {
    return collateralTokens
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token !== "" && token !== "0x0000000000000000000000000000000000000000")
  }

  console.warn(`Unexpected collateralTokens format:`, collateralTokens)
  return []
}

// Helper function to map database row to Request object with validation
const mapDatabaseRowToRequest = (row: any): Request => {
  if (!validateStatusValue(row.status)) {
    console.warn(`Invalid status value: ${row.status} for request ${row.requestId}`)
  }

  return {
    listingId: row.listingId || 0,
    requestId: row.requestId,
    author: row.author,
    amount: row.amount || "0",
    interest: row.interest || 0,
    totalRepayment: row.totalRepayment || "0",
    returnDate: row.returnDate || 0,
    lender: row.lender || "",
    loanRequestAddr: row.loanRequestAddr || row.tokenAddress || "",
    collateralTokens: parseCollateralTokens(row.collateralTokens),
    status: row.status,
  }
}

// Enhanced user fetching with high-volume user detection
const getUsersActiveRequests = async (): Promise<UserActiveRequests[]> => {
  try {
    console.log("📊 Fetching users with active requests from database...")

    const allRequests: Request[] = []
    const pageSize = 1000
    let page = 0
    let hasMore = true

    while (hasMore) {
      console.log(`📄 Fetching page ${page + 1} (${page * pageSize + 1}-${(page + 1) * pageSize})...`)

      const { data, error } = await supabase
        .from("kaleido_requests")
        .select("*")
        .eq("status", "SERVICED")
        .order("author")
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (error) throw error

      if (!data || data.length === 0) {
        hasMore = false
        break
      }

      const requests: Request[] = data.map(mapDatabaseRowToRequest)
      allRequests.push(...requests)

      console.log(`📈 Fetched ${data.length} requests (total so far: ${allRequests.length})`)

      hasMore = data.length === pageSize
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      page++
    }

    console.log(`✅ Completed pagination: fetched ${allRequests.length} total requests`)

    if (allRequests.length === 0) {
      console.log("No active requests found in database")
      return []
    }

    // Group requests by author and identify high-volume users
    const userRequestsMap = new Map<string, Request[]>()
    allRequests.forEach((request) => {
      const author = request.author.toLowerCase()
      if (!userRequestsMap.has(author)) {
        userRequestsMap.set(author, [])
      }
      userRequestsMap.get(author)!.push(request)
    })

    // Convert to array format with high-volume flagging
    const usersActiveRequests: UserActiveRequests[] = Array.from(userRequestsMap.entries()).map(
      ([author, requests]) => ({
        author,
        activeRequests: requests.sort((a, b) => a.requestId - b.requestId),
        totalActive: requests.length,
        isHighVolume: requests.length > MAX_REQUESTS_PER_USER,
      }),
    )

    console.log(`✅ Found ${usersActiveRequests.length} users with active requests`)
    console.log(`📈 Total active requests: ${allRequests.length}`)

    // Separate stats for high-volume vs regular users
    const highVolumeUsers = usersActiveRequests.filter((u) => u.isHighVolume)
    const regularUsers = usersActiveRequests.filter((u) => !u.isHighVolume)

    console.log(`🔥 High-volume users (>${MAX_REQUESTS_PER_USER} requests): ${highVolumeUsers.length}`)
    console.log(`👥 Regular users: ${regularUsers.length}`)

    // Log top users
    const topUsers = usersActiveRequests.sort((a, b) => b.totalActive - a.totalActive).slice(0, 5)
    console.log("👥 Top users by active requests:")
    topUsers.forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.author}: ${user.totalActive} requests ${user.isHighVolume ? "🔥" : ""}`)
    })

    return usersActiveRequests
  } catch (error: any) {
    console.error("❌ Error fetching users active requests:", error.message)
    throw error
  }
}

// Check if user needs update by comparing on-chain vs database
const needsUpdate = async (user: UserActiveRequests): Promise<boolean> => {
  try {
    const onChainRequests = await contract.getUserActiveRequests(user.author)
    const onChainIds = onChainRequests.map((req: any) => Number(req.requestId)).sort((a: any, b: any) => a - b)
    const dbIds = user.activeRequests.map((req) => req.requestId).sort((a, b) => a - b)

    if (onChainIds.length !== dbIds.length) {
      return true
    }

    for (let i = 0; i < onChainIds.length; i++) {
      if (onChainIds[i] !== dbIds[i]) {
        return true
      }
    }

    return false
  } catch (error: any) {
    console.log(`⚠️ Could not check on-chain state for ${user.author}, assuming update needed`)
    return true
  }
}

// Format request for contract
const formatRequestForContract = (request: Request) => {
  return {
    listingId: request.listingId,
    requestId: request.requestId,
    author: request.author,
    amount: request.amount,
    interest: request.interest,
    totalRepayment: request.totalRepayment,
    returnDate: request.returnDate,
    lender: request.lender,
    loanRequestAddr: request.loanRequestAddr,
    collateralTokens: request.collateralTokens,
    status: getContractStatusValue(request.status),
  }
}

// Enhanced update function with better nonce management
const updateUserActiveRequests = async (user: UserActiveRequests): Promise<boolean> => {
  const operationName = `Update ${user.author} (${user.totalActive} requests)`

  return executeWithRetry(
    async () => {
      console.log(`🔄 ${operationName}`)

      // Wait for nonce gap if needed
      await nonceManager.waitForNonceGap()

      const formattedRequests = user.activeRequests.map(formatRequestForContract)

      if (formattedRequests.length > 0) {
        console.log(`📋 Sample formatted request:`, JSON.stringify(formattedRequests[0], null, 2))
      }

      // Get next nonce
      const nonce = await nonceManager.getNextNonce()

      // Dynamic gas calculation with buffer for high-volume users
      const baseGas = 200000
      const gasPerRequest = user.isHighVolume ? 180000 : 150000 // More gas for complex operations
      const calculatedGas = baseGas + user.totalActive * gasPerRequest
      const maxGas = user.isHighVolume ? 12000000 : 8000000
      const gasLimit = Math.min(maxGas, calculatedGas)

      console.log(`⛽ Gas limit: ${gasLimit.toLocaleString()} (${user.totalActive} requests)`)

      const tx = await contract.batchAddUserRequests(user.author, formattedRequests, {
        gasLimit,
        nonce,
      })

      console.log(`📤 Transaction sent: ${tx.hash} (nonce: ${nonce})`)

      const receipt = await tx.wait()
      nonceManager.markNonceUsed(nonce)

      if (receipt.status === 1) {
        console.log(`✅ Successfully updated ${user.author}`)
        return true
      } else {
        console.log(`❌ Transaction failed for ${user.author}`)
        return false
      }
    },
    3,
    2000,
    operationName,
  )
    .then(() => true)
    .catch((error) => {
      console.error(`❌ Failed to update ${user.author}:`, error.message)
      return false
    })
}

// Process high-volume users with chunking strategy
const processHighVolumeUsers = async (
  highVolumeUsers: UserActiveRequests[],
): Promise<{ successful: number; failed: number; errors: string[] }> => {
  console.log(`\n🔥 Processing ${highVolumeUsers.length} high-volume users separately...`)

  const results = { successful: 0, failed: 0, errors: [] as string[] }
  const CHUNK_SIZE = 25 // Process requests in chunks of 25

  for (const user of highVolumeUsers) {
    try {
      console.log(`🔥 Processing high-volume user ${user.author} (${user.totalActive} requests)`)

      const updateNeeded = await needsUpdate(user)
      if (!updateNeeded) {
        console.log(`✅ ${user.author}: already up to date`)
        results.successful++
        continue
      }

      // Split requests into chunks if user has too many
      if (user.totalActive <= CHUNK_SIZE) {
        // Process normally if within chunk size
        const success = await updateUserActiveRequests(user)

        if (success) {
          results.successful++
        } else {
          results.failed++
          results.errors.push(`Failed to update high-volume user ${user.author}`)
        }
      } else {
        // Process in chunks
        console.log(`📦 Chunking ${user.totalActive} requests into ${Math.ceil(user.totalActive / CHUNK_SIZE)} chunks`)

        let chunkSuccess = true
        let processedChunks = 0

        // Process chunks directly without clearing (since we're adding to existing)
        for (let i = 0; i < user.totalActive; i += CHUNK_SIZE) {
          const chunk = user.activeRequests.slice(i, i + CHUNK_SIZE)
          const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1
          const totalChunks = Math.ceil(user.totalActive / CHUNK_SIZE)

          console.log(`📦 Processing chunk ${chunkNumber}/${totalChunks} for ${user.author} (${chunk.length} requests)`)

          try {
            // Create a temporary user object for this chunk
            const chunkUser: UserActiveRequests = {
              ...user,
              activeRequests: chunk,
              totalActive: chunk.length,
            }

            const chunkResult = await updateUserActiveRequests(chunkUser)

            if (chunkResult) {
              processedChunks++
              console.log(`✅ Chunk ${chunkNumber}/${totalChunks} successful for ${user.author}`)
            } else {
              console.error(`❌ Chunk ${chunkNumber}/${totalChunks} failed for ${user.author}`)
              chunkSuccess = false
              break
            }

            // Longer delay between chunks to prevent overwhelming the network
            if (i + CHUNK_SIZE < user.totalActive) {
              console.log(`⏳ Waiting 10 seconds before next chunk...`)
              await new Promise((resolve) => setTimeout(resolve, 10000))
            }
          } catch (error: any) {
            console.error(`❌ Error processing chunk ${chunkNumber} for ${user.author}:`, error.message)
            chunkSuccess = false
            break
          }
        }

        if (chunkSuccess && processedChunks === Math.ceil(user.totalActive / CHUNK_SIZE)) {
          results.successful++
          console.log(`✅ Successfully processed all chunks for ${user.author} (${processedChunks} chunks)`)
        } else {
          results.failed++
          results.errors.push(
            `Failed to process all chunks for ${user.author} (${processedChunks}/${Math.ceil(user.totalActive / CHUNK_SIZE)} successful)`,
          )
        }
      }

      // Longer delay between high-volume users
      await new Promise((resolve) => setTimeout(resolve, 8000))
    } catch (error: any) {
      results.failed++
      results.errors.push(`Error processing high-volume user ${user.author}: ${error.message}`)
      console.error(`❌ Error processing high-volume user ${user.author}:`, error.message)
    }
  }

  return results
}

// Enhanced batch processing with separate handling for different user types
const processUsersBatch = async (users: UserActiveRequests[]): Promise<SyncStats> => {
  const startTime = Date.now()

  // Separate users by type
  const regularUsers = users.filter((u) => !u.isHighVolume)
  const highVolumeUsers = users.filter((u) => u.isHighVolume)

  const stats: SyncStats = {
    totalUsers: users.length,
    processedUsers: 0,
    skippedUsers: 0,
    totalRequests: users.reduce((sum, user) => sum + user.totalActive, 0),
    successfulUpdates: 0,
    failedUpdates: 0,
    duration: 0,
    errors: [],
    highVolumeUsersProcessed: 0,
  }

  console.log(`🚀 Starting batch processing...`)
  console.log(`👥 Regular users: ${regularUsers.length}`)
  console.log(`🔥 High-volume users: ${highVolumeUsers.length}`)

  // Process regular users in batches
  for (let i = 0; i < regularUsers.length; i += BATCH_SIZE) {
    const batch = regularUsers.slice(i, i + BATCH_SIZE)
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(regularUsers.length / BATCH_SIZE)

    console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} users)`)

    for (const user of batch) {
      try {
        if (user.totalActive > MAX_REQUESTS_PER_USER) {
          console.log(`⚠️ Skipping ${user.author}: too many requests (${user.totalActive})`)
          stats.skippedUsers++
          stats.processedUsers++
          continue
        }

        const updateNeeded = await needsUpdate(user)
        if (!updateNeeded) {
          console.log(`✅ ${user.author}: already up to date`)
          stats.processedUsers++
          continue
        }

        const success = await updateUserActiveRequests(user)

        if (success) {
          stats.successfulUpdates++
        } else {
          stats.failedUpdates++
          stats.errors.push(`Failed to update ${user.author}`)
        }

        stats.processedUsers++
        await new Promise((resolve) => setTimeout(resolve, 2000))
      } catch (error: any) {
        stats.failedUpdates++
        stats.errors.push(`Error processing ${user.author}: ${error.message}`)
        console.error(`❌ Error processing ${user.author}:`, error.message)
      }
    }

    if (i + BATCH_SIZE < regularUsers.length) {
      console.log("⏳ Waiting 3 seconds before next batch...")
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }

  // Process high-volume users separately
  if (highVolumeUsers.length > 0) {
    const highVolumeResults = await processHighVolumeUsers(highVolumeUsers)
    stats.successfulUpdates += highVolumeResults.successful
    stats.failedUpdates += highVolumeResults.failed
    stats.errors.push(...highVolumeResults.errors)
    stats.highVolumeUsersProcessed = highVolumeResults.successful + highVolumeResults.failed
  }

  stats.duration = Date.now() - startTime
  return stats
}

// Main sync function
const syncUserActiveRequests = async (): Promise<void> => {
  try {
    console.log("\n🔄 === STARTING USER ACTIVE REQUESTS SYNC ===")

    // Refresh nonce at the start
    await nonceManager.refreshNonce()
    console.log(`🔢 Starting with nonce: ${await nonceManager.getCurrentNonce()}`)

    const users = await getUsersActiveRequests()

    if (users.length === 0) {
      console.log("✅ No users with active requests to sync")
      return
    }

    const stats = await processUsersBatch(users)

    // Print final summary
    console.log("\n📊 === SYNC SUMMARY ===")
    console.log(`👥 Total users: ${stats.totalUsers}`)
    console.log(`📝 Total active requests: ${stats.totalRequests}`)
    console.log(`✅ Successful updates: ${stats.successfulUpdates}`)
    console.log(`❌ Failed updates: ${stats.failedUpdates}`)
    console.log(`⚠️ Skipped users: ${stats.skippedUsers}`)
    console.log(`🔥 High-volume users processed: ${stats.highVolumeUsersProcessed}`)
    console.log(`⏱️ Duration: ${(stats.duration / 1000).toFixed(2)}s`)

    if (stats.errors.length > 0) {
      console.log(`\n⚠️ Errors encountered:`)
      stats.errors.slice(0, 5).forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`)
      })
      if (stats.errors.length > 5) {
        console.log(`  ... and ${stats.errors.length - 5} more errors`)
      }
    }
  } catch (error: any) {
    console.error("💥 Sync failed:", error.message)
    throw error
  }
}

// Cleanup function
const cleanupServicedRequests = async (): Promise<void> => {
  try {
    console.log("\n🧹 === CLEANING UP NON-SERVICED REQUESTS ===")

    const { data: nonServicedRequests, error } = await supabase
      .from("kaleido_requests")
      .select("author, requestId")
      .neq("status", "SERVICED")

    if (error) throw error

    if (!nonServicedRequests || nonServicedRequests.length === 0) {
      console.log("✅ No non-serviced requests to cleanup")
      return
    }

    console.log(`🔍 Found ${nonServicedRequests.length} non-serviced requests to remove`)

    for (const request of nonServicedRequests) {
      await executeWithRetry(
        async () => {
          const nonce = await nonceManager.getNextNonce()

          const tx = await contract.removeUserActiveRequest(request.author, request.requestId, {
            gasLimit: 200000,
            nonce,
          })

          await tx.wait()
          nonceManager.markNonceUsed(nonce)
          console.log(`✅ Removed request ${request.requestId} from ${request.author}`)
        },
        2,
        1000,
        `Remove request ${request.requestId}`,
      )

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  } catch (error: any) {
    console.error("💥 Cleanup failed:", error.message)
  }
}

// Main service loop
const runUserActiveRequestsService = async (): Promise<void> => {
  console.log(`🚀 Starting Enhanced User Active Requests Sync Service`)
  console.log(`⏰ Sync interval: ${SYNC_INTERVAL / 1000} seconds`)
  console.log(`📦 Regular batch size: ${BATCH_SIZE} users`)
  console.log(`🔥 High-volume batch size: ${HIGH_VOLUME_BATCH_SIZE} users`)
  console.log(`📊 Max requests per user (before chunking): ${MAX_REQUESTS_PER_USER}`)
  console.log(`📦 Chunk size for high-volume users: ${CHUNK_SIZE}`)

  let runCount = 0

  while (true) {
    try {
      runCount++
      const timestamp = new Date().toISOString()
      console.log(`\n🔄 === SYNC RUN #${runCount} at ${timestamp} ===`)

      await syncUserActiveRequests()

      console.log(`\n⏰ Next sync in ${SYNC_INTERVAL / 1000} seconds...`)
      console.log("=".repeat(50))
    } catch (error: any) {
      console.error("💥 Service error:", error)
      console.log("🔄 Will retry in next interval...")
      // Refresh nonce manager on error
      await nonceManager.refreshNonce()
    }

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

// Export for testing
export { getUsersActiveRequests, syncUserActiveRequests, cleanupServicedRequests }

runUserActiveRequestsService().catch((error) => {
  console.error("💥 Service startup failed:", error)
  process.exit(1)
})
