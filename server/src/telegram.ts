import axios from "axios"
import dotenv from "dotenv"
dotenv.config()

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`
const CHAT_ID = process.env.TELEGRAM_CHAT_ID
// --- Queue and State ---
interface AlertQueueItem {
  message: string
  resolve: () => void
  reject: (error?: any) => void
}

interface SendTelegramAlert {
  (message: string): Promise<void>
}
interface Sleep {
  (ms: number): Promise<void>
}
interface SendTelegramAlertQueueItem {
  message: string
  resolve: () => void
  reject: (error?: any) => void
}

const alertQueue: AlertQueueItem[] = []
let isProcessing = false
let lastSentAt = 0

// --- Sleep Helper ---
const sleep: Sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// --- Main Queue Processor ---
const processQueue = async () => {
  if (isProcessing) return
  isProcessing = true

  while (alertQueue.length > 0) {
    const item = alertQueue.shift()
    if (!item) {
      continue
    }
    const { message, resolve, reject } = item

    // Throttle: Ensure at least 1s between messages
    const now = Date.now()
    const sinceLast = now - lastSentAt
    if (sinceLast < 5000) {
      await sleep(5000 - sinceLast)
    }

    try {
      await axios.post(TELEGRAM_API, {
        chat_id: CHAT_ID,
        text: message,
        // parse_mode: "MarkdownV2",
      })
      lastSentAt = Date.now()
      console.log("✅ Telegram alert sent")
      resolve()
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as any).response === "object" &&
        (error as any).response !== null &&
        "status" in (error as any).response &&
        (error as any).response.status === 429
      ) {
        // Telegram rate limiting
        const retryAfter = (error as any).response.data?.parameters?.retry_after || 5
        console.error(`❌ Rate limited. Waiting ${retryAfter} seconds...`)
        alertQueue.unshift({ message, resolve, reject })
        await sleep(retryAfter * 1000)
      } else {
        const errorMessage =
          typeof error === "object" && error !== null && "message" in error ? (error as any).message : String(error)
        console.error("❌ Failed to send Telegram alert:", errorMessage)
        reject(error)
      }
    }
  }
  isProcessing = false
}

// --- Exported Alert Function ---

export const sendTelegramAlert: SendTelegramAlert = (message) => {
  return new Promise<void>((resolve, reject) => {
    alertQueue.push({ message, resolve, reject } as SendTelegramAlertQueueItem)
    processQueue()
  })
}
