import { ethers } from "ethers"
import { HermesClient } from "@pythnetwork/hermes-client"
import { pythAbi } from "../abi/pythAbi"
import { envSchema } from "../config/envSchema"
import dotenv from "dotenv"
import { UpdateCheckResult } from "./type/priceType"
import { normalizePythPrice, getTimestamp, extractPrice } from "./utils/pyth"
dotenv.config()

const parsedEnv = envSchema.safeParse(process.env)
console.log("parsedEnv present:", parsedEnv)
if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:", parsedEnv.error.format())
  process.exit(1)
}
const CONFIG = parsedEnv.data

const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL)
const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY || "", provider)
const contract = new ethers.Contract(CONFIG.PYTH_ORACLE_ADDRESS || "", pythAbi, wallet)
const hermes = new HermesClient("https://hermes.pyth.network")

const PYTH_FEED_IDS: string[] = [CONFIG.ETH_PYTH_FEED_ID, CONFIG.USDC_PYTH_FEED_ID]
const priceThresholds: Record<string, number> = {
  [CONFIG.ETH_PYTH_FEED_ID]: 0.005,
  [CONFIG.USDC_PYTH_FEED_ID]: 0.002,
}
const CoinName: Record<string, string> = {
  [CONFIG.ETH_PYTH_FEED_ID]: "ETH",
  [CONFIG.USDC_PYTH_FEED_ID]: "USDC",
}

async function shouldUpdatePrice(feedIds: string[], newPrices: number[]): Promise<UpdateCheckResult> {
  const updatesNeeded: Record<string, boolean> = {}
  let shouldUpdate = false

  try {
    if (!Array.isArray(feedIds) || !Array.isArray(newPrices) || feedIds.length !== newPrices.length) {
      throw new Error("feedIds and newPrices must be arrays of the same length")
    }

    for (let i = 0; i < feedIds.length; i++) {
      const individualFeedId = feedIds[i]
      const newPrice = newPrices[i]

      if (!PYTH_FEED_IDS.includes(individualFeedId)) {
        throw new Error(`Feed ID ${individualFeedId} is not in the configured Pyth feed IDs`)
      }

      const currentPriceRaw = await contract.getPrice(individualFeedId)
      const currentPrice = normalizePythPrice(currentPriceRaw)
      const name = CoinName[individualFeedId] || "Unknown Coin"

      const priceChange = Math.abs((newPrice - currentPrice) / currentPrice)
      const threshold = priceThresholds[individualFeedId] || 0.005

      console.log(
        `📊 Checking Price for ${name}\n` +
          `→ Latest Price: ${newPrice.toFixed(6)}\n` +
          `→ Current Price: ${currentPrice.toFixed(6)}\n` +
          `→ Change: ${(priceChange * 100).toFixed(4)}%\n` +
          `→ Threshold: ${(threshold * 100).toFixed(2)}%\n`,
      )

      if (priceChange > threshold) {
        updatesNeeded[individualFeedId] = true
        shouldUpdate = true
        console.log("Updating price for", name, "as change exceeds threshold")
      } else {
        updatesNeeded[individualFeedId] = false
        console.log(
          `🔍 [${getTimestamp()}] Price change for ${name} is below threshold: ${priceChange.toFixed(4)} < ${threshold}. No update needed.`,
        )
      }
    }

    return { shouldUpdate, updatesNeeded }
  } catch (error) {
    console.log("Price check failed, updating anyway:", error)
    const fallback: Record<string, boolean> = {}
    feedIds.forEach((id) => (fallback[id] = true))
    return { shouldUpdate: true, updatesNeeded: fallback }
  }
}

async function updatePrice(
  contract: ethers.Contract,
  priceUpdate: { binary?: { data?: string[] } },
  feedId: string,
): Promise<void> {
  try {
    // Validate that binary data exists
    if (!priceUpdate.binary?.data || !Array.isArray(priceUpdate.binary.data)) {
      throw new Error(`No binary data available for feed ${feedId}`)
    }

    const binaryData = priceUpdate.binary.data.map((hex) => "0x" + hex)
    const feeData = await provider.getFeeData()
    const maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits("20", "gwei")
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits("5", "gwei")
    const safeMaxPriorityFeePerGas = maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : maxPriorityFeePerGas
    const gasEstimate = await contract.updatePrice.estimateGas(binaryData, feedId)

    const tx = await contract.updatePrice(binaryData, feedId, {
      gasLimit: (gasEstimate * BigInt(12)) / BigInt(10),
      maxFeePerGas,
      maxPriorityFeePerGas: safeMaxPriorityFeePerGas,
    })

    console.log(`🔁 [${getTimestamp()}] Sent tx: ${tx.hash}`)
    const receipt = await tx.wait()
    const name = CoinName[feedId] || "Unknown Coin"
    console.log(`✅ [${getTimestamp()}] Price updated for ${name}: ${receipt.hash}`)
  } catch (error: any) {
    if (error?.message?.includes("known transaction")) {
      console.warn(`⚠️ [${getTimestamp()}] Known tx, already pending. Skipping.`)
    } else {
      console.error(`❌ [${getTimestamp()}] Failed to update price for ${CoinName[feedId] || feedId}:`, error)
    }
  }
}

async function runUpdater(): Promise<void> {
  console.log("\n--------------------------------------------")
  console.log(`🕒 [${getTimestamp()}] Starting price update run...`)
  try {
    const [ethUpdate, usdcUpdate] = await Promise.all([
      hermes.getLatestPriceUpdates([CONFIG.ETH_PYTH_FEED_ID]),
      hermes.getLatestPriceUpdates([CONFIG.USDC_PYTH_FEED_ID]),
    ])
    if (!ethUpdate.parsed || !usdcUpdate.parsed) {
      console.error(`❌ [${getTimestamp()}] No price updates found for ETH or USDC`)
      return
    }

    // Fix: Add validation for required price properties
    const ethPriceData = ethUpdate.parsed[0].price
    const usdcPriceData = usdcUpdate.parsed[0].price

    // Validate that required properties exist
    if (!ethPriceData.price || ethPriceData.expo === undefined) {
      console.error(`❌ [${getTimestamp()}] Invalid ETH price data:`, ethPriceData)
      return
    }

    if (!usdcPriceData.price || usdcPriceData.expo === undefined) {
      console.error(`❌ [${getTimestamp()}] Invalid USDC price data:`, usdcPriceData)
      return
    }

    const newPrices = [
      extractPrice({ price: ethPriceData.price, expo: ethPriceData.expo }),
      extractPrice({ price: usdcPriceData.price, expo: usdcPriceData.expo }),
    ]

    const { shouldUpdate, updatesNeeded } = await shouldUpdatePrice(PYTH_FEED_IDS, newPrices)
    if (!shouldUpdate) {
      console.log(`🔍 [${getTimestamp()}] No price updates needed.`)
      return
    }

    for (let i = 0; i < PYTH_FEED_IDS.length; i++) {
      const feedId = PYTH_FEED_IDS[i]
      if (updatesNeeded[feedId]) {
        const priceUpdate = feedId === CONFIG.ETH_PYTH_FEED_ID ? ethUpdate : usdcUpdate
        if (!priceUpdate.binary?.data) {
          console.error(`❌ [${getTimestamp()}] No binary data available for ${CoinName[feedId] || feedId}`)
          continue
        }

        await updatePrice(contract, priceUpdate, feedId)
      }
    }
  } catch (err) {
    console.error(`❌ [${getTimestamp()}] Error fetching or updating price:`, err)
  } finally {
    console.log(`⏳ [${getTimestamp()}] Waiting for next update cycle...\n`)
  }
}

const INTERVAL_MS = 30 * 1000
setInterval(runUpdater, INTERVAL_MS)
runUpdater()
