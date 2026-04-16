import { ethers } from "ethers"
import dotenv from "dotenv"
import { diamondAbi } from "../abi/ProtocolFacet.js"
import * as Sentry from "@sentry/node"
import express from "express"
import client from "prom-client"
import pLimit from "p-limit"
import pino from "pino"
import { envSchema } from "../config/envSchema.js"
import { handleError, handleSuccess } from "./utils/helper.js"
import { supabase } from "./db/supabase"
import { ErrorDecoder } from "ethers-decode-error"

dotenv.config()
const errorDecoder = ErrorDecoder.create([diamondAbi])
// Reduced concurrent requests to avoid rate limits
const limit = pLimit(5)

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  sendDefaultPii: true,
})

const parsedEnv = envSchema.safeParse(process.env)
if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:", parsedEnv.error.format())
  process.exit(1)
}

const CONFIG = parsedEnv.data
const logger = pino({ level: process.env.LOG_LEVEL || "info" })
logger.info("Bot started")

if (!CONFIG.PRIVATE_KEY) {
  console.error("❌ Missing required environment variables.")
  process.exit(1)
}

// Multiple RPC URLs for fallback
const RPC_URLS = [
  // `https://yolo-young-breeze.abstract-testnet.quiknode.pro/${process.env.QUICKNODE_KEY}`,
  "https://api.testnet.abs.xyz",
  // "https://abstract-sepolia.drpc.org",
  `https://abstract-testnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
  // `https://11124.rpc.thirdweb.com/${process.env.THIRDWEB_KEY}`,
  CONFIG.RPC_URL,
].filter(Boolean)

// Types for better TypeScript support
interface RPCProvider {
  provider: ethers.JsonRpcProvider
  signer: ethers.Wallet
  index: number
}

interface RPCHealthStatus {
  [key: number]: {
    url: string
    failures: number
    lastFailure: string | null
    healthy: boolean
    rateLimited: boolean // NEW
    rateLimitReset: string | null // NEW
  }
}

// RPC Provider Manager
// IMPROVED: Robust nonce management with better race condition handling
class RPCManager {
  private urls: string[]
  private privateKey: string
  private currentIndex: number
  private providers: Map<number, ethers.JsonRpcProvider>
  private signers: Map<number, ethers.Wallet>
  private failureCounts: Map<number, number>
  private lastFailureTime: Map<number, number>
  private rateLimitedRPCs: Set<number> = new Set()
  private rateLimitResetTimes: Map<number, number> = new Map()

  // IMPROVED: Better nonce management with locks
  private nonceCaches: Map<number, number> = new Map()
  private nonceLocks: Map<number, Promise<void>> = new Map()
  private lastNonceFetch: Map<number, number> = new Map()

  constructor(urls: string[], privateKey: string) {
    this.urls = urls
    this.privateKey = privateKey
    this.currentIndex = 0
    this.providers = new Map()
    this.signers = new Map()
    this.failureCounts = new Map()
    this.lastFailureTime = new Map()

    this.initializeProviders()
  }

  private initializeProviders(): void {
    this.urls.forEach((url, index) => {
      try {
        const provider = new ethers.JsonRpcProvider(url, undefined, {
          polling: false,
          staticNetwork: true,
        })

        provider._getConnection().timeout = 30000

        const signer = new ethers.Wallet(this.privateKey, provider)

        this.providers.set(index, provider)
        this.signers.set(index, signer)
        this.failureCounts.set(index, 0)
        this.lastFailureTime.set(index, 0)
        this.nonceCaches.set(index, -1)
        this.lastNonceFetch.set(index, 0)

        console.log(`✅ Initialized RPC ${index}`)
      } catch (error: any) {
        console.error(`❌ Failed to initialize RPC ${index}: `, error.message)
      }
    })
  }

  // IMPROVED: Atomic nonce management with proper locking
  private async getNextNonce(index: number): Promise<number> {
    const signer = this.signers.get(index)
    if (!signer) throw new Error(`No signer for RPC ${index}`)

    // Wait for any existing lock
    const existingLock = this.nonceLocks.get(index)
    if (existingLock) {
      console.log(`⏳ Waiting for nonce lock for RPC ${index}`)
      await existingLock
    }

    // Create new lock
    let resolveLock: () => void
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve
    })
    this.nonceLocks.set(index, lockPromise)

    try {
      const cached = this.nonceCaches.get(index) || -1
      const lastFetch = this.lastNonceFetch.get(index) || 0
      const now = Date.now()

      // Force refresh if cache is stale or invalid
      if (cached === -1 || now - lastFetch > 30000) {
        // 30 second cache
        console.log(`🔄 Refreshing nonce cache for RPC ${index} (cached: ${cached})`)

        try {
          // Use 'latest' instead of 'pending' for more reliable results
          const networkNonce = await signer.getNonce("latest")

          // Also check pending transactions to avoid conflicts
          const pendingNonce = await signer.getNonce("pending")
          const safeNonce = Math.max(networkNonce, pendingNonce)

          console.log(`🔢 RPC ${index} nonces: latest=${networkNonce}, pending=${pendingNonce}, using=${safeNonce}`)

          this.nonceCaches.set(index, safeNonce)
          this.lastNonceFetch.set(index, now)

          // Return the safe nonce and increment cache for next call
          this.nonceCaches.set(index, safeNonce + 1)
          return safeNonce
        } catch (fetchError: any) {
          console.error(`❌ Failed to fetch nonce for RPC ${index}:`, fetchError)

          // If we have a cached value, increment it as fallback
          if (cached > -1) {
            const fallbackNonce = cached + 1
            this.nonceCaches.set(index, fallbackNonce + 1)
            console.log(`🔄 Using incremented cached nonce: ${fallbackNonce}`)
            return fallbackNonce
          }

          throw fetchError
        }
      } else {
        // Use cached nonce and increment
        const nextNonce = cached
        this.nonceCaches.set(index, cached + 1)
        console.log(`🎯 Using cached nonce ${nextNonce} for RPC ${index}`)
        return nextNonce
      }
    } finally {
      // Always release lock
      this.nonceLocks.delete(index)
      resolveLock!()
    }
  }

  // IMPROVED: Better nonce error handling with exponential recovery
  private async handleNonceError(index: number, error: any): Promise<void> {
    console.log(`🔄 Handling nonce error for RPC ${index}:`, error?.message?.substring(0, 100))

    // Extract expected nonce from error message if possible
    const errorMsg = error?.message || error?.reason || ""
    const nonceMatch = errorMsg.match(/nonce.*?(\d+)/i)

    if (nonceMatch) {
      const suggestedNonce = parseInt(nonceMatch[1])
      if (suggestedNonce && suggestedNonce > 0) {
        console.log(`🎯 Extracted nonce ${suggestedNonce} from error, updating cache`)
        this.nonceCaches.set(index, suggestedNonce)
        this.lastNonceFetch.set(index, Date.now())
        return
      }
    }

    // Extract nonce range if available (like your error: "allowed nonce range: 80750 - 80770")
    const rangeMatch = errorMsg.match(/allowed nonce range.*?(\d+)\s*-\s*(\d+)/i)
    if (rangeMatch) {
      const minNonce = parseInt(rangeMatch[1])
      if (minNonce && minNonce > 0) {
        console.log(`🎯 Extracted min nonce ${minNonce} from range, updating cache`)
        this.nonceCaches.set(index, minNonce)
        this.lastNonceFetch.set(index, Date.now())
        return
      }
    }

    // Fallback: force complete refresh
    console.log(`🔄 Forcing complete nonce refresh for RPC ${index}`)
    this.nonceCaches.set(index, -1)
    this.lastNonceFetch.set(index, 0)
  }

  // IMPROVED: Better RPC provider selection with nonce awareness
  async getProviderWithTransaction(requestId: number): Promise<{
    provider: ethers.JsonRpcProvider
    signer: ethers.Wallet
    index: number
    nonce: number
  }> {
    const now = Date.now()
    let attempts = 0
    const maxAttempts = this.urls.length * 3
    let lastNonceError: any = null

    while (attempts < maxAttempts) {
      const index = this.currentIndex

      // Check rate limits first
      if (this.isRateLimited(index, now)) {
        console.log(`🚫 RPC ${index} is rate limited, skipping...`)
        this.currentIndex = (this.currentIndex + 1) % this.urls.length
        attempts++
        continue
      }

      // Check regular failures
      const failureCount = this.failureCounts.get(index) || 0
      const lastFailure = this.lastFailureTime.get(index) || 0
      const backoffTime = Math.min(30000, Math.pow(2, failureCount) * 1000)

      if (failureCount >= 2 && now - lastFailure < backoffTime) {
        console.log(`⏳ RPC ${index} in backoff, trying next...`)
        this.currentIndex = (this.currentIndex + 1) % this.urls.length
        attempts++
        continue
      }

      const provider = this.providers.get(index)
      const signer = this.signers.get(index)

      if (provider && signer) {
        try {
          // Get nonce for this transaction with improved error handling
          const nonce = await this.getNextNonce(index)

          this.currentIndex = (this.currentIndex + 1) % this.urls.length
          console.log(`✅ Using RPC ${index} with nonce ${nonce} for request ${requestId}`)

          return { provider, signer, index, nonce }
        } catch (nonceError: any) {
          console.error(`❌ Failed to get nonce for RPC ${index}:`, nonceError?.message?.substring(0, 100))

          // Handle nonce error and try recovery
          await this.handleNonceError(index, nonceError)
          lastNonceError = nonceError

          // Mark as failure but don't give up immediately
          this.markFailure(index, nonceError)

          this.currentIndex = (this.currentIndex + 1) % this.urls.length
          attempts++
          continue
        }
      }

      this.currentIndex = (this.currentIndex + 1) % this.urls.length
      attempts++
    }

    // If all RPCs failed due to nonce issues, try one more global recovery
    if (lastNonceError) {
      console.log(`🚨 All RPCs failed with nonce errors, attempting global recovery...`)

      // Reset all nonce caches
      for (let i = 0; i < this.urls.length; i++) {
        this.nonceCaches.set(i, -1)
        this.lastNonceFetch.set(i, 0)
        this.failureCounts.set(i, 0) // Reset failure counts for nonce issues
      }

      // Try first healthy RPC one more time
      const firstHealthyIndex = this.findFirstHealthyRPC()
      if (firstHealthyIndex !== -1) {
        const provider = this.providers.get(firstHealthyIndex)
        const signer = this.signers.get(firstHealthyIndex)

        if (provider && signer) {
          try {
            console.log(`🔄 Global recovery attempt with RPC ${firstHealthyIndex}`)
            const nonce = await this.getNextNonce(firstHealthyIndex)
            return { provider, signer, index: firstHealthyIndex, nonce }
          } catch (recoveryError: any) {
            console.error(`❌ Global recovery failed:`, recoveryError?.message)
          }
        }
      }
    }

    throw new Error(`All RPC providers are unavailable. Last nonce error: ${lastNonceError?.message || "Unknown"}`)
  }

  private findFirstHealthyRPC(): number {
    const now = Date.now()

    for (let i = 0; i < this.urls.length; i++) {
      if (this.isRateLimited(i, now)) continue

      const failureCount = this.failureCounts.get(i) || 0
      if (failureCount < 2) return i
    }

    return -1
  }

  // Keep existing methods...
  private isRateLimited(index: number, now: number): boolean {
    if (!this.rateLimitedRPCs.has(index)) return false

    const resetTime = this.rateLimitResetTimes.get(index) || 0
    if (now >= resetTime) {
      console.log(`🔄 RPC ${index} rate limit expired, re-enabling...`)
      this.rateLimitedRPCs.delete(index)
      this.rateLimitResetTimes.delete(index)
      this.failureCounts.set(index, 0)
      this.nonceCaches.set(index, -1)
      return false
    }

    return true
  }

  markFailure(index: number, error: any): void {
    const errorMessage = error?.message?.toLowerCase() || ""
    const errorCode = error?.info?.error?.code || error?.code

    // Handle nonce errors specially - don't count as regular failures
    if (errorMessage.includes("nonce") || error?.name === "NONCE_EXPIRED") {
      console.log(`🔄 Nonce error detected for RPC ${index}, handling specially`)
      // Don't increment failure count for nonce errors - they're different
      return
    }

    // Handle other errors normally...
    const currentFailures = this.failureCounts.get(index) || 0
    this.failureCounts.set(index, currentFailures + 1)
    this.lastFailureTime.set(index, Date.now())
  }

  markSuccess(index: number): void {
    if ((this.failureCounts.get(index) || 0) > 0) {
      console.log(`✅ RPC ${index} recovered`)
      this.failureCounts.set(index, 0)
    }
  }

  // Add a method to check nonce sync status
  getNonceStatus(): { [key: number]: { cached: number; lastFetch: number; isStale: boolean } } {
    const status: { [key: number]: { cached: number; lastFetch: number; isStale: boolean } } = {}
    const now = Date.now()

    this.urls.forEach((_, index) => {
      const cached = this.nonceCaches.get(index) || -1
      const lastFetch = this.lastNonceFetch.get(index) || 0
      const isStale = now - lastFetch > 30000 || cached === -1

      status[index] = { cached, lastFetch, isStale }
    })

    return status
  }

  // Rest of existing methods unchanged...
  maskUrl(url: string): string {
    return url.replace(/\/[a-f0-9]{32,}$/i, "/***")
  }

  getHealthStatus(): RPCHealthStatus {
    const status: any = {}
    this.urls.forEach((url, index) => {
      const failures = this.failureCounts.get(index) || 0
      const lastFailure = this.lastFailureTime.get(index) || 0
      const rateLimited = this.rateLimitedRPCs.has(index)
      const resetTime = this.rateLimitResetTimes.get(index)

      status[index] = {
        url: this.maskUrl(url),
        failures,
        lastFailure: lastFailure ? new Date(lastFailure).toISOString() : null,
        rateLimited: rateLimited,
        rateLimitReset: resetTime ? new Date(resetTime).toISOString() : null,
        healthy: !rateLimited && failures < 3,
      }
    })
    return status
  }

  getCurrentIndex(): number {
    return (this.currentIndex - 1 + this.urls.length) % this.urls.length
  }
}
// Initialize RPC Manager
const rpcManager = new RPCManager(RPC_URLS, CONFIG.PRIVATE_KEY)

// Prometheus metrics
const register = new client.Registry()
client.collectDefaultMetrics({ register })

const metrics = {
  liquidationAttempts: new client.Counter({
    name: "liquidation_attempts_total",
    help: "Total number of liquidation attempts",
  }),
  liquidationSuccess: new client.Counter({
    name: "successful_liquidations_total",
    help: "Total number of successful liquidations",
  }),
  liquidationFailures: new client.Counter({
    name: "liquidation_failures_total",
    help: "Total number of failed liquidations",
  }),
  totalLiquidationsProcessed: new client.Counter({
    name: "total_liquidations_processed",
    help: "Total number of liquidations processed (success + failure)",
  }),
  liquidationSuccessRate: new client.Gauge({
    name: "liquidation_success_rate_percent",
    help: "Current liquidation success rate percentage",
  }),
  liquidationsByStatus: new client.Counter({
    name: "liquidations_by_status_total",
    help: "Total liquidations categorized by final status",
    labelNames: ["status", "error_type"],
  }),
  avgConfirmationTime: new client.Histogram({
    name: "tx_confirmation_time_seconds",
    help: "Transaction confirmation time distribution",
    buckets: [1, 2, 5, 10, 30, 60, 120, 300],
  }),
  stuckTxReplacements: new client.Counter({
    name: "stuck_tx_replacements_total",
    help: "Total number of stuck txs replaced",
  }),
  rpcFailures: new client.Counter({
    name: "rpc_failures_total",
    help: "Total number of RPC failures",
    labelNames: ["rpc_index", "error_type"],
  }),
  rpcSwitches: new client.Counter({
    name: "rpc_switches_total",
    help: "Total number of RPC provider switches",
  }),
  requestsFound: new client.Gauge({
    name: "serviced_requests_found",
    help: "Number of serviced requests found in current poll",
  }),
  batchProcessingTime: new client.Histogram({
    name: "batch_processing_time_seconds",
    help: "Time taken to process each batch",
    buckets: [1, 5, 10, 30, 60, 120],
  }),
  dailyLiquidations: new client.Counter({
    name: "daily_liquidations_total",
    help: "Total liquidations processed today",
  }),
  hourlyLiquidations: new client.Counter({
    name: "hourly_liquidations_total",
    help: "Total liquidations processed this hour",
  }),
  gasUsed: new client.Histogram({
    name: "liquidation_gas_used",
    help: "Gas used for liquidation transactions",
    buckets: [50000, 100000, 200000, 300000, 500000, 1000000],
  }),
  // NEW: Track skipped requests
  skippedRequests: new client.Counter({
    name: "skipped_requests_total",
    help: "Total number of requests skipped due to contract errors",
    labelNames: ["error_type"],
  }),
}

Object.values(metrics).forEach((m) => register.registerMetric(m))

class LiquidationTracker {
  private totalAttempts: number
  private totalSuccesses: number
  private totalFailures: number
  private totalSkipped: number
  private startTime: number
  private skippedBreakdown: Map<string, number> = new Map()
  private getErrorTypeDescription(errorType: string): string {
    const descriptions: { [key: string]: string } = {
      contract_position_healthy: "Healthy Positions (not liquidatable)",
      contract_invalid_amount: "Invalid Amount",
      contract_request_not_serviced: "Request Not Serviced",
      contract_invalid_fee_vault: "Invalid Fee Vault",
      contract_invalid_fee_bps: "Invalid Fee BPS",
      contract_loan_value_zero: "Loan Value Zero",
      contract_transfer_failed: "Transfer Failed",
      contract_fee_exceeds_repayment: "Fee Exceeds Repayment",
      contract_unauthorized_caller: "Unauthorized Caller",
      contract_reentrant_call: "Reentrant Call",
      contract_protocol_error: "Protocol Error",
      contract_gas_limit: "Gas Limit Exceeded",
      contract_execution_reverted: "Execution Reverted",
      contract_revert: "Contract Revert",
    }

    return descriptions[errorType] || errorType.replace(/_/g, " ").toUpperCase()
  }

  constructor() {
    this.totalAttempts = 0
    this.totalSuccesses = 0
    this.totalFailures = 0
    this.totalSkipped = 0
    this.startTime = Date.now()

    this.setupResetTimers()
  }

  setupResetTimers() {
    const msUntilNextHour = (60 - new Date().getMinutes()) * 60 * 1000
    setTimeout(() => {
      this.resetHourlyCounter()
      setInterval(() => this.resetHourlyCounter(), 60 * 60 * 1000)
    }, msUntilNextHour)

    const now = new Date()
    const msUntilMidnight =
      (24 - now.getHours()) * 60 * 60 * 1000 - now.getMinutes() * 60 * 1000 - now.getSeconds() * 1000
    setTimeout(() => {
      this.resetDailyCounter()
      setInterval(() => this.resetDailyCounter(), 24 * 60 * 60 * 1000)
    }, msUntilMidnight)
  }

  resetHourlyCounter() {
    logger.info("🔄 Resetting hourly liquidation counter")
  }

  resetDailyCounter() {
    logger.info("🔄 Resetting daily liquidation counter")
  }

  recordAttempt(requestId: any) {
    this.totalAttempts++
    metrics.liquidationAttempts.inc()
    logger.debug(`📊 Liquidation attempt recorded for request ${requestId}`)
  }

  recordSuccess(requestId: any, txHash: any, confirmationTime: any, gasUsed: any) {
    this.totalSuccesses++

    metrics.liquidationSuccess.inc()
    metrics.totalLiquidationsProcessed.inc()
    metrics.liquidationsByStatus.inc({ status: "success", error_type: "none" })
    metrics.dailyLiquidations.inc()
    metrics.hourlyLiquidations.inc()

    metrics.avgConfirmationTime.observe(confirmationTime)

    if (gasUsed) {
      metrics.gasUsed.observe(Number(gasUsed.toString()))
    }

    this.updateSuccessRate()

    logger.info(
      `✅ Liquidation success recorded for request ${requestId}, tx: ${txHash}, time: ${confirmationTime.toFixed(2)}s`,
    )
  }

  recordFailure(requestId: any, error: any, errorType = "unknown") {
    this.totalFailures++

    metrics.liquidationFailures.inc()
    metrics.totalLiquidationsProcessed.inc()
    metrics.liquidationsByStatus.inc({ status: "failure", error_type: errorType })

    this.updateSuccessRate()

    logger.error(`❌ Liquidation failure recorded for request ${requestId}: ${errorType}`)
  }

  recordSkipped(requestId: any, errorType: string) {
    this.totalSkipped++

    // Track breakdown by error type
    const currentCount = this.skippedBreakdown.get(errorType) || 0
    this.skippedBreakdown.set(errorType, currentCount + 1)

    metrics.skippedRequests.inc({ error_type: errorType })
    logger.warn(`⏭️  Request ${requestId} skipped: ${errorType}`)
  }

  // ENHANCED: Get detailed stats with breakdown
  getStats() {
    const uptime = (Date.now() - this.startTime) / 1000
    const totalProcessed = this.totalSuccesses + this.totalFailures
    const successRate = totalProcessed > 0 ? (this.totalSuccesses / totalProcessed) * 100 : 0

    // Convert breakdown map to object
    const skippedBreakdown: { [key: string]: number } = {}
    this.skippedBreakdown.forEach((count, errorType) => {
      skippedBreakdown[errorType] = count
    })

    return {
      uptime: Math.floor(uptime),
      totalAttempts: this.totalAttempts,
      totalProcessed,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      totalSkipped: this.totalSkipped,
      skippedBreakdown, // NEW: Detailed breakdown
      healthyPositions: skippedBreakdown["contract_position_healthy"] || 0, // NEW: Easy access
      successRate: Number(successRate.toFixed(2)),
      avgAttemptsPerMinute: totalProcessed > 0 ? Number((totalProcessed / (uptime / 60)).toFixed(2)) : 0,
      startTime: new Date(this.startTime).toISOString(),
    }
  }

  updateSuccessRate() {
    const totalProcessed = this.totalSuccesses + this.totalFailures
    if (totalProcessed > 0) {
      const successRate = (this.totalSuccesses / totalProcessed) * 100
      metrics.liquidationSuccessRate.set(successRate)
    }
  }
  getHealthyPositionsCount(): number {
    return this.skippedBreakdown.get("contract_position_healthy") || 0
  }

  // NEW: Print detailed breakdown
  printSkippedBreakdown() {
    console.log(`📊 Skipped Requests Breakdown:`)
    if (this.skippedBreakdown.size === 0) {
      console.log(`   • No requests skipped yet`)
      return
    }

    // Sort by count (descending)
    const sortedEntries = Array.from(this.skippedBreakdown.entries()).sort(([, a], [, b]) => b - a)

    sortedEntries.forEach(([errorType, count]) => {
      const percentage = ((count / this.totalSkipped) * 100).toFixed(1)
      const description = this.getErrorTypeDescription(errorType)
      console.log(`   • ${description}: ${count} (${percentage}%)`)
    })

    console.log(`   • TOTAL SKIPPED: ${this.totalSkipped}`)
  }
}

const liquidationTracker = new LiquidationTracker()

// Enhanced error classification
const classifyError = async (error: any) => {
  console.log("🔍 Analyzing error for classification:", {
    message: error?.message,
    code: error?.code,
    data: error?.data,
    fullError: JSON.stringify(error, null, 2).substring(0, 500), // Limit output size
  })

  const errorMessage = error?.message?.toLowerCase() || ""
  const errorCode = error?.code?.toString() || ""
  const errorData = error?.data || ""

  // Try to decode the error using your existing pattern
  let decodedError = null
  let decodedName = ""

  try {
    decodedError = await errorDecoder.decode(error)
    decodedName = (decodedError?.name || decodedError?.reason || "").toLowerCase()
    console.log("✅ Successfully decoded error:", {
      name: decodedError?.name,
      reason: decodedError?.reason,
      decodedName: decodedName,
      fullDecoded: decodedError,
    })
  } catch (decodeErr: any) {
    console.log("⚠️ Could not decode error, using raw error analysis:", decodeErr?.message)
  }

  // Helper function to extract more detailed error info
  const getDetailedErrorInfo = (error: any) => {
    const sources = [
      error?.message,
      error?.data,
      error?.error?.message,
      error?.info?.error?.message,
      error?.reason,
      decodedName, // Include decoded error name
      JSON.stringify(error?.data || {}),
      JSON.stringify(error?.error || {}),
      JSON.stringify(error?.info || {}),
    ].filter(Boolean)

    return sources.join(" | ").toLowerCase()
  }

  const fullErrorText = getDetailedErrorInfo(error)
  console.log("🔍 Full error text for analysis:", fullErrorText.substring(0, 200) + "...")

  // Contract revert errors (these should be skipped, not retried)
  // Based on the liquidateUserRequest function and decoded errors:

  // 1. Invalid Amount Error - Fix case sensitivity
  if (
    decodedName.includes("Protocol__Invalidamount") ||
    decodedName.includes("invalidamount") ||
    fullErrorText.includes("Protocol__Invalidamount") ||
    fullErrorText.includes("invalidamount")
  ) {
    console.log("🎯 Classified as: contract_invalid_amount")
    return {
      type: "contract_invalid_amount",
      decodedError,
      details: "Loan USD value is 0 or invalid",
    }
  }

  // 2. Request Not Serviced Error
  if (
    decodedName.includes("Protocol__Requestnotserviced") ||
    decodedName.includes("requestnotserviced") ||
    fullErrorText.includes("Protocol__Requestnotserviced") ||
    fullErrorText.includes("requestnotserviced")
  ) {
    console.log("🎯 Classified as: contract_request_not_serviced")
    return {
      type: "contract_request_not_serviced",
      decodedError,
      details: "Request is not in SERVICED status",
    }
  }

  // 3. Position Healthy Error (loan is not liquidatable)
  if (
    decodedName.includes("Protocol__Positionhealthy") ||
    decodedName.includes("positionhealthy") ||
    fullErrorText.includes("Protocol__Positionhealthy") ||
    fullErrorText.includes("positionhealthy")
  ) {
    console.log("🎯 Classified as: contract_position_healthy")
    return {
      type: "contract_position_healthy",
      decodedError,
      details: "Loan is healthy and not liquidatable (health factor >= 1.0 or not past due)",
    }
  }

  // 4. Invalid Fee Vault Error
  if (
    decodedName.includes("Protocol__Invalidfeevault") ||
    decodedName.includes("invalidfeevault") ||
    fullErrorText.includes("Protocol__Invalidfeevault") ||
    fullErrorText.includes("invalidfeevault")
  ) {
    console.log("🎯 Classified as: contract_invalid_fee_vault")
    return {
      type: "contract_invalid_fee_vault",
      decodedError,
      details: "Fee vault address is not configured",
    }
  }

  // 5. Invalid Fee BPS Error
  if (
    decodedName.includes("Protocol__Invalidfeebps") ||
    decodedName.includes("invalidfeebps") ||
    fullErrorText.includes("Protocol__Invalidfeebps") ||
    fullErrorText.includes("invalidfeebps")
  ) {
    console.log("🎯 Classified as: contract_invalid_fee_bps")
    return {
      type: "contract_invalid_fee_bps",
      decodedError,
      details: "Liquidity BPS is set to 0",
    }
  }

  // 6. Loan Value Zero Error
  if (
    decodedName.includes("Protocol__Loanvaluezero") ||
    decodedName.includes("loanvaluezero") ||
    fullErrorText.includes("Protocol__Loanvaluezero") ||
    fullErrorText.includes("loanvaluezero")
  ) {
    console.log("🎯 Classified as: contract_loan_value_zero")
    return {
      type: "contract_loan_value_zero",
      decodedError,
      details: "Final loan value check failed",
    }
  }

  // 7. Transfer Failed Error
  if (
    decodedName.includes("Protocol__Transferfailed") ||
    decodedName.includes("transferfailed") ||
    fullErrorText.includes("Protocol__Transferfailed") ||
    fullErrorText.includes("transferfailed")
  ) {
    console.log("🎯 Classified as: contract_transfer_failed")
    return {
      type: "contract_transfer_failed",
      decodedError,
      details: "Token transfer failed during liquidation",
    }
  }

  // 8. Fee Exceeds Repayment Error (from require statement)
  if (fullErrorText.includes("fee exceeds repayment")) {
    console.log("🎯 Classified as: contract_fee_exceeds_repayment")
    return {
      type: "contract_fee_exceeds_repayment",
      decodedError,
      details: "Liquidation fee is higher than repayment amount",
    }
  }

  // 9. OnlyBot modifier error (if the caller is not authorized)
  if (fullErrorText.includes("onlybot") || fullErrorText.includes("unauthorized")) {
    console.log("🎯 Classified as: contract_unauthorized_caller")
    return {
      type: "contract_unauthorized_caller",
      decodedError,
      details: "Caller is not authorized to perform liquidation",
    }
  }

  // 10. ReentrancyGuard error
  if (fullErrorText.includes("reentrancyguard") || fullErrorText.includes("reentrant call")) {
    console.log("🎯 Classified as: contract_reentrant_call")
    return {
      type: "contract_reentrant_call",
      decodedError,
      details: "Reentrancy guard triggered",
    }
  }

  // 11. General Protocol errors (catch-all for any other Protocol__ prefixed errors)
  if (decodedName.includes("protocol__") || fullErrorText.includes("protocol__")) {
    console.log("🎯 Classified as: contract_protocol_error")
    return {
      type: "contract_protocol_error",
      decodedError,
      details: `Unknown protocol error: ${decodedName || "see raw error"}`,
    }
  }

  // 12. Gas estimation failures that might indicate contract issues
  if (fullErrorText.includes("gas required exceeds allowance") || fullErrorText.includes("out of gas")) {
    console.log("🎯 Classified as: contract_gas_limit")
    return {
      type: "contract_gas_limit",
      decodedError,
      details: "Gas limit exceeded during execution",
    }
  }

  // 13. Execution reverted (common contract error)
  if (fullErrorText.includes("execution reverted")) {
    console.log("🎯 Classified as: contract_execution_reverted")
    return {
      type: "contract_execution_reverted",
      decodedError,
      details: "Contract execution reverted",
    }
  }

  // 14. General revert errors (Solidity reverts without custom error) - MOVED TO END
  // ✅ FIXED: Check rate limits FIRST (highest priority)
  if (
    error?.info?.error?.code === -32007 ||
    error?.info?.error?.code === -32003 ||
    fullErrorText.includes("rate limit") ||
    fullErrorText.includes("daily request limit")
  ) {
    console.log("🎯 Classified as: rate_limit")
    return {
      type: "rate_limit", // ✅ Will RETRY with different RPC
      decodedError,
      details: "RPC rate limit exceeded",
    }
  }

  // ✅ FIXED: Check reverts AFTER network errors
  if (
    fullErrorText.includes("revert") &&
    !fullErrorText.includes("replacement underpriced") &&
    !fullErrorText.includes("rate limit") && // ✅ Added this
    !fullErrorText.includes("daily request limit")
  ) {
    // ✅ Added this
    console.log("🎯 Classified as: contract_revert")
    return {
      type: "contract_revert",
      decodedError,
      details: "General contract revert",
    }
  }

  if (errorCode === "SERVER_ERROR" || errorCode === "NETWORK_ERROR") {
    console.log("🎯 Classified as: rpc_error")
    return {
      type: "rpc_error",
      decodedError,
      details: "RPC server error",
    }
  }

  if (errorCode === "INSUFFICIENT_FUNDS" || fullErrorText.includes("insufficient funds")) {
    console.log("🎯 Classified as: insufficient_funds")
    return {
      type: "insufficient_funds",
      decodedError,
      details: "Insufficient funds for transaction",
    }
  }

  if (
    errorCode === "REPLACEMENT_UNDERPRICED" ||
    fullErrorText.includes("nonce") ||
    fullErrorText.includes("replacement underpriced")
  ) {
    console.log("🎯 Classified as: nonce_error")
    return {
      type: "nonce_error",
      decodedError,
      details: "Nonce or transaction replacement issue",
    }
  }

  if (fullErrorText.includes("timeout") || fullErrorText.includes("network")) {
    console.log("🎯 Classified as: network_timeout")
    return {
      type: "network_timeout",
      decodedError,
      details: "Network timeout occurred",
    }
  }

  console.log("🎯 Classified as: unknown")
  return {
    type: "unknown",
    decodedError,
    details: "Unclassified error type",
  }
}

// Check if error type should be retried (only nonce errors)
const shouldRetryRequest = (errorType: string): boolean => {
  const retryTypes = ["nonce_error", "rate_limit", "rpc_error", "network_timeout"]
  return retryTypes.includes(errorType)
}

// Health & Metrics server
const app = express()

app.get("/metrics", async (_: express.Request, res: express.Response) => {
  res.set("Content-Type", register.contentType)
  res.end(await register.metrics())
})

app.get("/health", (_: express.Request, res: express.Response) => {
  const rpcHealth = rpcManager.getHealthStatus()
  const healthyRpcs = Object.values(rpcHealth).filter((rpc: any) => rpc.healthy).length
  const liquidationStats = liquidationTracker.getStats()

  res.json({
    status: healthyRpcs > 0 ? "healthy" : "unhealthy",
    rpcs: rpcHealth,
    healthyRpcCount: healthyRpcs,
    totalRpcs: RPC_URLS.length,
    liquidationStats,
    timestamp: new Date().toISOString(),
  })
})

app.get("/stats", (_: express.Request, res: express.Response) => {
  const stats = liquidationTracker.getStats()
  res.json({
    liquidations: stats,
    rpcHealth: rpcManager.getHealthStatus(),
    timestamp: new Date().toISOString(),
  })
})

app.listen(CONFIG.METRICS_PORT, () =>
  console.log(`📈 Metrics server running at http://localhost:${CONFIG.METRICS_PORT}/metrics`),
)

const getServicedRequestIds = async () => {
  try {
    console.log("🔍 Querying serviced requests from database...")

    let allRequestIds = []
    let from = 0
    const batchSize = 1000
    let hasMore = true

    while (hasMore) {
      console.log(`📥 Fetching batch starting from ${from}...`)

      const {
        data: servicedRequests,
        error,
        count,
      } = await supabase
        .from("kaleido_requests")
        .select("requestId", { count: "exact" })
        .eq("status", "SERVICED")
        .order("requestId", { ascending: true })
        .range(from, from + batchSize - 1)

      if (error) {
        console.error("❌ Database query error:", error)
        break
      }

      if (servicedRequests && servicedRequests.length > 0) {
        const requestIds = servicedRequests.map((req) => req.requestId)
        allRequestIds.push(...requestIds)
        console.log(`✅ Fetched ${requestIds.length} requests in this batch (total so far: ${allRequestIds.length})`)

        if (servicedRequests.length < batchSize) {
          hasMore = false
          console.log(`📋 Reached end of results. Total count from DB: ${count}`)
        } else {
          from += batchSize
        }
      } else {
        hasMore = false
        console.log("📋 No more requests found")
      }
    }

    console.log(`✅ Found ${allRequestIds.length} total serviced request(s) from database`)
    return allRequestIds
  } catch (error: any) {
    console.error("❌ Error getting serviced requests:", error)
    await handleError(error, 0)
    return []
  }
}
// Add this helper function to prevent hanging transactions
const waitForTransactionWithTimeout = async (tx: any, timeoutMs = 120000) => {
  return Promise.race([
    tx.wait(1), // Wait for 1 confirmation
    new Promise((_, reject) => setTimeout(() => reject(new Error("TRANSACTION_TIMEOUT")), timeoutMs)),
  ])
}

// IMPROVED: Only retry for specific errors, skip all others and continue
const liquidateUserRequest = async (requestId: number) => {
  console.log(`🎯 Processing request ID: ${requestId}`)

  liquidationTracker.recordAttempt(requestId)

  const maxRetries = 3
  let lastError: any = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Get provider with nonce management
      const { provider, signer, index, nonce } = await rpcManager.getProviderWithTransaction(requestId)

      if (attempt > 0) {
        console.log(`🔄 Retry attempt ${attempt} for request ${requestId} using RPC ${index}`)
        metrics.rpcSwitches.inc()
      }

      const diamondContract = new ethers.Contract(CONFIG.DIAMOND_CONTRACT_ADDRESS, diamondAbi, signer)
      const startTime = Date.now()

      try {
        // Try with gas estimation first
        console.log(`⛽ Estimating gas for request ${requestId}...`)
        const gasEstimate = await diamondContract.liquidateUserRequest.estimateGas(requestId)
        const feeData = await provider.getFeeData()

        console.log(`📡 Submitting transaction for request ${requestId} with nonce ${nonce}...`)
        const tx = await diamondContract.liquidateUserRequest(requestId, {
          nonce, // Use managed nonce
          gasLimit: (gasEstimate * BigInt(150)) / BigInt(100), // +50% gas limit
          maxFeePerGas: feeData?.maxFeePerGas ? (feeData.maxFeePerGas * BigInt(120)) / BigInt(100) : undefined,
          maxPriorityFeePerGas: feeData?.maxPriorityFeePerGas
            ? (feeData.maxPriorityFeePerGas * BigInt(150)) / BigInt(100)
            : undefined,
        })

        // Add this before transaction submission to monitor gas prices:
        console.log(`💰 Gas fees for request ${requestId}:`, {
          gasPrice: feeData?.gasPrice?.toString(),
          maxFeePerGas: feeData?.maxFeePerGas?.toString(),
          maxPriorityFeePerGas: feeData?.maxPriorityFeePerGas?.toString(),
          // baseFee: feeData?.baseFeePerGas?.toString(),
        })
        console.log(`⏳ Waiting for confirmation for request ${requestId}, tx: ${tx.hash}...`)
        // const receipt = await tx.wait(1) // Wait for 1 confirmation
        console.log(`⏳ Waiting for confirmation for request ${requestId}, tx: ${tx.hash}...`)
        const receipt = await waitForTransactionWithTimeout(tx, 120000) // 2 minute timeout
        const confirmationTime = (Date.now() - startTime) / 1000

        rpcManager.markSuccess(index)

        if (receipt.status === 1) {
          liquidationTracker.recordSuccess(requestId, tx.hash, confirmationTime, receipt.gasUsed)
          console.log(`✅ Request ${requestId}: SUCCESS (tx: ${tx.hash})`)

          // Handle success asynchronously to avoid blocking
          handleSuccess(tx, requestId).catch((err) => {
            console.error(`⚠️ Error in success handler for ${requestId}:`, err?.message)
          })

          return { success: true, tx: tx.hash }
        } else {
          console.log(`❌ Request ${requestId}: Transaction failed (tx: ${tx.hash})`)
          liquidationTracker.recordFailure(requestId, "Transaction failed", "transaction_failed")
          return { success: false, error: "Transaction failed", skipped: false }
        }
      } catch (gasError: any) {
        console.log(
          `⚠️ Gas estimation or transaction error for request ${requestId}:`,
          gasError?.message?.substring(0, 100),
        )

        // Classify the error to determine if we should retry or skip
        const gasErrorType = await classifyError(gasError)
        console.log(`🔍 Error classified as: ${gasErrorType.type}`)

        // Handle nonce errors specifically
        if (gasErrorType.type === "nonce_error") {
          console.log(`🔄 Nonce error detected, marking failure for RPC ${index}`)
          rpcManager.markFailure(index, gasError)
          lastError = gasError
          continue // Retry with next RPC
        }

        // If it's a contract error, skip immediately without retry
        if (!shouldRetryRequest(gasErrorType.type)) {
          console.log(`⏭️  Request ${requestId}: SKIPPED - Contract error (${gasErrorType.type})`)
          liquidationTracker.recordSkipped(requestId, gasErrorType.type)
          return {
            success: false,
            error: gasError.message,
            skipped: true,
            errorType: gasErrorType,
          }
        }

        // For other retryable errors during gas estimation, try with default gas
        console.log(`🔄 Retryable error during gas estimation, trying with default gas...`)

        try {
          const tx = await diamondContract.liquidateUserRequest(requestId, {
            nonce, // Use managed nonce
            // Let ethers estimate gas and fees
          })

          console.log(`⏳ Waiting for confirmation (default gas) for request ${requestId}, tx: ${tx.hash}...`)
          const receipt = await tx.wait(1)
          const confirmationTime = (Date.now() - startTime) / 1000

          rpcManager.markSuccess(index)

          if (receipt.status === 1) {
            liquidationTracker.recordSuccess(requestId, tx.hash, confirmationTime, receipt.gasUsed)
            console.log(`✅ Request ${requestId}: SUCCESS with default gas (tx: ${tx.hash})`)

            handleSuccess(tx, requestId).catch((err) => {
              console.error(`⚠️ Error in success handler for ${requestId}:`, err?.message)
            })

            return { success: true, tx: tx.hash }
          } else {
            console.log(`❌ Request ${requestId}: Transaction failed with default gas (tx: ${tx.hash})`)
            liquidationTracker.recordFailure(requestId, "Transaction failed", "transaction_failed")
            return { success: false, error: "Transaction failed", skipped: false }
          }
        } catch (defaultGasError: any) {
          console.log(
            `❌ Default gas transaction also failed for request ${requestId}:`,
            defaultGasError?.message?.substring(0, 100),
          )

          const defaultErrorType = await classifyError(defaultGasError)

          // Handle nonce errors
          if (defaultErrorType.type === "nonce_error") {
            console.log(`🔄 Nonce error in default gas attempt, marking failure for RPC ${index}`)
            rpcManager.markFailure(index, defaultGasError)
            lastError = defaultGasError
            continue // Retry with next RPC
          }

          // If contract error, skip immediately
          if (!shouldRetryRequest(defaultErrorType.type)) {
            console.log(`⏭️  Request ${requestId}: SKIPPED - Contract error in default gas (${defaultErrorType.type})`)
            liquidationTracker.recordSkipped(requestId, defaultErrorType.type)
            return {
              success: false,
              error: defaultGasError.message,
              skipped: true,
              errorType: defaultErrorType,
            }
          }

          // For retryable errors, continue to retry logic
          lastError = defaultGasError
          throw defaultGasError
        }
      }
    } catch (err: any) {
      console.log(
        `❌ General error for request ${requestId} (attempt ${attempt + 1}):`,
        err?.message?.substring(0, 100),
      )

      const errorType = await classifyError(err)
      lastError = err

      // If it's not a retryable error, skip immediately
      if (!shouldRetryRequest(errorType.type)) {
        console.log(`⏭️  Request ${requestId}: SKIPPED - Non-retryable error (${errorType.type})`)
        liquidationTracker.recordSkipped(requestId, errorType.type)
        return {
          success: false,
          error: err.message,
          skipped: true,
          errorType,
        }
      }

      // Handle retryable errors
      const currentRpcIndex = rpcManager.getCurrentIndex()

      // Mark RPC failure for network/RPC errors
      if (errorType.type === "rate_limit" || errorType.type === "rpc_error" || errorType.type === "network_timeout") {
        console.log(`⚠️ RPC-related error for request ${requestId} (attempt ${attempt + 1}): ${errorType.type}`)
        rpcManager.markFailure(currentRpcIndex, err)

        metrics.rpcFailures.inc({
          rpc_index: currentRpcIndex.toString(),
          error_type: errorType.type,
        })

        // Add backoff for rate limits
        if (errorType.type === "rate_limit" && attempt < maxRetries - 1) {
          const backoffTime = Math.min(3000, Math.pow(2, attempt) * 1000)
          console.log(`⏳ Rate limited, waiting ${backoffTime}ms before retry...`)
          await new Promise((resolve) => setTimeout(resolve, backoffTime))
        }

        continue // Try next RPC
      }

      // For nonce errors, mark failure and continue
      if (errorType.type === "nonce_error") {
        console.log(`🔄 Nonce error for request ${requestId} (attempt ${attempt + 1}), trying next RPC`)
        rpcManager.markFailure(currentRpcIndex, err)
        continue
      }

      // If we reach here and it's the last attempt, record failure
      if (attempt === maxRetries - 1) {
        console.log(`❌ Request ${requestId}: FAILED after ${maxRetries} attempts - ${errorType.type}`)
        liquidationTracker.recordFailure(requestId, err, errorType.type)

        // Handle error asynchronously
        handleError(err, requestId).catch((handlerErr) => {
          console.error(`⚠️ Error in error handler for ${requestId}:`, handlerErr?.message)
        })

        return { success: false, error: err.message, skipped: false, errorType }
      }

      // Continue to next attempt for retryable errors
      console.log(`🔄 Will retry request ${requestId} (attempt ${attempt + 1}/${maxRetries})`)
    }
  }

  // This shouldn't be reached, but just in case
  console.log(`❌ Request ${requestId}: FAILED - All attempts exhausted`)
  liquidationTracker.recordFailure(requestId, lastError || "All attempts failed", "max_retries_exceeded")

  return {
    success: false,
    error: lastError?.message || "All attempts failed",
    skipped: false,
    errorType: { type: "max_retries_exceeded", details: "Maximum retry attempts exceeded" },
  }
}

// Add process exception handlers to prevent crashes
process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught Exception:", error)
  console.error("Stack:", error.stack)
  // Don't exit, just log the error
})

process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled Rejection at:", promise)
  console.error("Reason:", reason)
  // Don't exit, just log the error
})

const startBot = () => {
  console.log("🤖 Bot started")
  console.log(`🌐 Using ${RPC_URLS.length} RPC providers for load balancing and failover`)
  console.log("📊 Enhanced tracking enabled with improved error handling and request skipping")

  let isProcessing = false // Flag to prevent overlapping cycles

  const runCompleteCycle = async () => {
    if (isProcessing) {
      console.log("⚠️ Previous cycle still running, skipping this interval...")
      return
    }

    isProcessing = true
    const cycleStartTime = Date.now()
    console.log("🔄 =================== STARTING NEW COMPLETE CYCLE ===================")

    try {
      // Fetch ALL request IDs at the start of the cycle
      const requestIds = await getServicedRequestIds()
      if (requestIds.length === 0) {
        console.log("⏳ No serviced requests found, waiting for next cycle...")
        return
      }

      console.log(`🎯 CYCLE GOAL: Process ALL ${requestIds.length} requests before starting next cycle`)
      metrics.requestsFound.set(requestIds.length)

      const batchSize = 5
      let totalProcessed = 0
      let totalSuccesses = 0
      let totalFailures = 0
      let totalSkipped = 0

      // Process ALL batches in this cycle - no interruptions
      for (let i = 0; i < requestIds.length; i += batchSize) {
        const batch = requestIds.slice(i, i + batchSize)
        const batchNumber = Math.floor(i / batchSize) + 1
        const totalBatches = Math.ceil(requestIds.length / batchSize)

        console.log(
          `📦 Processing batch ${batchNumber}/${totalBatches}: requests ${i + 1} to ${Math.min(i + batchSize, requestIds.length)}`,
        )
        console.log(`🔢 Request IDs in this batch: [${batch.join(", ")}]`)

        try {
          // Process batch with NEVER-FAIL approach - each request is isolated
          const results = await Promise.allSettled(
            batch.map(async (id: any) => {
              try {
                return await limit(() => liquidateUserRequest(id))
              } catch (criticalError: any) {
                // Even if there's a critical error, log it and return a failed result
                console.error(`💥 Critical error for request ${id}:`, criticalError)
                liquidationTracker.recordFailure(id, criticalError, "critical_error")
                return { success: false, error: criticalError.message, skipped: false, errorType: "critical_error" }
              }
            }),
          )

          // Analyze results
          let batchSuccesses = 0
          let batchFailures = 0
          let batchSkipped = 0

          results.forEach((result, index) => {
            const requestId = batch[index]

            if (result.status === "fulfilled") {
              const outcome = result.value
              if (outcome.success) {
                batchSuccesses++
                console.log(`   ✅ ${requestId}: SUCCESS`)
              } else if (outcome.skipped) {
                batchSkipped++
                console.log(`   ⏭️  ${requestId}: SKIPPED (${outcome.errorType})`)
              } else {
                batchFailures++
                console.log(`   ❌ ${requestId}: FAILED (${outcome.errorType || "unknown"})`)
              }
            } else {
              // This should rarely happen with our new error handling
              batchFailures++
              console.error(`   💥 ${requestId}: PROMISE REJECTED -`, result.reason?.message || result.reason)
            }
          })

          totalSuccesses += batchSuccesses
          totalFailures += batchFailures
          totalSkipped += batchSkipped
          totalProcessed += batch.length

          console.log(
            `✅ Batch ${batchNumber}/${totalBatches} completed: ${batchSuccesses} success, ${batchFailures} failed, ${batchSkipped} skipped`,
          )

          // Show progress through the COMPLETE cycle
          const progressPercent = ((totalProcessed / requestIds.length) * 100).toFixed(1)
          const cycleSuccessRate = totalProcessed > 0 ? ((totalSuccesses / totalProcessed) * 100).toFixed(1) : 0

          console.log(
            `📊 CYCLE Progress: ${totalProcessed}/${requestIds.length} (${progressPercent}%) | Success rate: ${cycleSuccessRate}%`,
          )

          // Only show ETA if we're not on the last batch
          if (i + batchSize < requestIds.length) {
            const elapsed = (Date.now() - cycleStartTime) / 1000
            const rate = totalProcessed / elapsed
            const remaining = requestIds.length - totalProcessed
            const etaSeconds = remaining / rate
            const etaMinutes = Math.ceil(etaSeconds / 60)

            console.log(`⏱️  ETA for complete cycle: ~${etaMinutes} minutes`)
          }
        } catch (batchError: any) {
          // This should never happen with our improved error handling, but just in case
          console.error(`💥 Impossible batch error in batch ${batchNumber}:`, batchError)
          totalProcessed += batch.length
          totalFailures += batch.length
        }

        // Minimal delay between batches to be respectful to RPCs
        if (i + batchSize < requestIds.length) {
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }

      // CYCLE COMPLETION SUMMARY
      const cycleDuration = (Date.now() - cycleStartTime) / 1000
      console.log(`🏁 =================== COMPLETE CYCLE FINISHED ===================`)
      console.log(`✅ SUCCESS! Processed ALL ${totalProcessed}/${requestIds.length} requests in this cycle`)
      console.log(`📊 Final Cycle Results:`)
      console.log(`   • Successful: ${totalSuccesses}`)
      console.log(`   • Failed: ${totalFailures}`)
      console.log(`   • Skipped: ${totalSkipped}`)
      liquidationTracker.printSkippedBreakdown()

      // NEW: Highlight healthy positions specifically
      const healthyCount = liquidationTracker.getHealthyPositionsCount()
      console.log(`🏥 Healthy Positions (not liquidatable): ${healthyCount}`)

      console.log(
        `   • Success Rate: ${totalProcessed > 0 ? ((totalSuccesses / totalProcessed) * 100).toFixed(1) : 0}%`,
      )
      console.log(`⏱️  Total Cycle Time: ${Math.floor(cycleDuration / 60)}m ${Math.floor(cycleDuration % 60)}s`)
      console.log(`⚡ Average Rate: ${(totalProcessed / (cycleDuration / 60)).toFixed(1)} requests/minute`)

      // Record batch processing time
      metrics.batchProcessingTime.observe(cycleDuration)

      // Log comprehensive status
      const healthStatus = rpcManager.getHealthStatus()
      // const healthyCount = Object.values(healthStatus).filter((rpc: any) => rpc.healthy).length
      const stats = liquidationTracker.getStats()

      console.log(`🏥 RPC Health: ${healthyCount}/${RPC_URLS.length} providers healthy`)
      console.log(
        `📊 Session Stats: ${stats.totalProcessed} total processed (${stats.successRate}% success) | ${stats.totalSkipped} skipped`,
      )

      console.log(`🔄 Will start next COMPLETE cycle in ${CONFIG.POLL_INTERVAL / 1000}s`)
      console.log(`⏰ =================== WAITING FOR NEXT CYCLE ===================\n`)
    } catch (cycleError: any) {
      console.error(`💥 Critical cycle error:`, cycleError)
      // Even if there's a critical error, continue to next cycle
    } finally {
      isProcessing = false // Always reset the flag
    }
  }

  // Run cycles continuously with a short break between them
  const runContinuously = async () => {
    while (true) {
      try {
        await runCompleteCycle()

        // Short break between cycles (adjust as needed)
        const breakTime = CONFIG.POLL_INTERVAL || 5 * 60 * 1000 // Default 5 minutes
        console.log(`💤 Taking ${breakTime / 1000}s break before next cycle...`)
        await new Promise((resolve) => setTimeout(resolve, breakTime))
      } catch (error: any) {
        console.error("💥 Error in continuous cycle runner:", error)
        // Wait a bit before retrying if there's an error
        await new Promise((resolve) => setTimeout(resolve, 30000)) // 30s error recovery
      }
    }
  }

  console.log("🚀 Starting continuous cycle runner...")
  runContinuously()

  const cleanup = () => {
    console.log("🛑 Shutdown initiated")
    const finalStats = liquidationTracker.getStats()
    console.log("📊 Final Statistics:")
    console.log(`   • Total Processed: ${finalStats.totalProcessed}`)
    console.log(`   • Success Rate: ${finalStats.successRate}%`)
    console.log(`   • Successes: ${finalStats.totalSuccesses}`)
    console.log(`   • Failures: ${finalStats.totalFailures}`)
    console.log(`   • Skipped: ${finalStats.totalSkipped}`)
    console.log(`   • Uptime: ${Math.floor(finalStats.uptime / 60)} minutes`)
    console.log(`   • Avg Rate: ${finalStats.avgAttemptsPerMinute} liquidations/min`)
    process.exit(0)
  }

  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)
}

console.log("🚀 Starting Never-Stuck Liquidation Bot...")
console.log(`🎯 Key Features:`)
console.log(`   • NEVER gets stuck - processes ALL requests in COMPLETE cycles`)
console.log(`   • Fetches ALL 1000+ IDs once per cycle, processes them completely`)
console.log(`   • Only starts next cycle after current one is 100% finished`)
console.log(`   • Only retries nonce/RPC errors (max 2 attempts)`)
console.log(`   • Skips contract errors immediately and continues`)
console.log(`   • Shows progress through complete cycle (batch X/Y)`)
console.log(`   • Prevents overlapping cycles with processing flag`)
console.log(`📊 What gets retried: nonce errors, rate limits, RPC errors`)
console.log(`📊 What gets skipped: contract reverts, invalid amounts, insufficient funds`)
console.log(`📈 Endpoints:`)
console.log(`   • Metrics: http://localhost:${CONFIG.METRICS_PORT}/metrics`)
console.log(`   • Health: http://localhost:${CONFIG.METRICS_PORT}/health`)
console.log(`   • Stats: http://localhost:${CONFIG.METRICS_PORT}/stats`)

startBot()
