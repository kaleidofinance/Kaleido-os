import { sendTelegramAlert } from "../telegram"
import * as Sentry from "@sentry/node"
import { ErrorDecoder } from "ethers-decode-error"
import { diamondAbi } from "../../abi/ProtocolFacet.js"
import { txType, errorType } from "../type/helper.js"

const errorDecoder = ErrorDecoder.create([diamondAbi])
const ADDRESS_1 = "0x0000000000000000000000000000000000000001"

const CRITICAL_NETWORK_ERRORS = ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT"]

/**
 * Handles errors by logging them, decoding them, and sending alerts via Telegram.
 * @param {any} error - The error object to handle.
 * @param {number} requestId - The ID of the request associated with the error.
 */
export const handleError = async (error: any, requestId: number): Promise<void> => {
  console.error("❌ Error:", error)
  Sentry.captureException(error)

  try {
    const decoded = await errorDecoder.decode(error)
    console.error("🔍 Decoded error:", decoded)

    const baseMessage = `🛑 Error liquidating user with Request ID ${requestId}:\n${
      error.message || error.toString()
    }\n\n🔍 Decoded: ${JSON.stringify(decoded, null, 2)}`

    const isCriticalNetworkError =
      (error.code && CRITICAL_NETWORK_ERRORS.includes(error.code)) ||
      (decoded.name && CRITICAL_NETWORK_ERRORS.includes(decoded.name))

    const alertMessage = isCriticalNetworkError ? `🚨 CRITICAL NETWORK ERROR\n${baseMessage}` : baseMessage

    await sendTelegramAlert(alertMessage)
  } catch (decodeErr) {
    const err = decodeErr as errorType
    console.error("❌ Error decoding the error:", decodeErr)

    const fallbackMessage = `❌ Error:\n${error.message || error.toString()}\n\n⚠️ Decode Error:\n${
      err.message || err.toString()
    }`

    await sendTelegramAlert(fallbackMessage)
  }
}

/**
 * Handles successful liquidation by logging and sending notification via Telegram.
 * @param {txType} tx - The transaction object containing hash and other details.
 * @param {number} requestId - The ID of the successfully liquidated request.
 */
export const handleSuccess = async (tx: txType, requestId: number): Promise<void> => {
  try {
    console.log(`✅ Liquidation successful for Request ID ${requestId} | Tx Hash: ${tx.hash}`)

    const alertMessage = [
      "✅ Liquidation Successful!",
      "",
      `📋 Request ID: ${requestId}`,
      `🔗 Transaction: https://sepolia.abscan.org/tx/${tx.hash}`,
    ].join("\n")

    await sendTelegramAlert(alertMessage)
  } catch (err) {
    const error = err as errorType
    console.error("🚨 Error in handleSuccess:", error)

    const errorMessage = `🚨 Error in handleSuccess for Request ID ${requestId}: ${error.message}`
    await sendTelegramAlert(errorMessage)
  }
}

/**
 * Returns the decimal places for a given token address.
 * @param {string} tokenAddress - The token contract address.
 * @returns {number} The number of decimal places for the token.
 */
export const getTokenDecimals = (tokenAddress: string): number => {
  if (tokenAddress.toLowerCase() === ADDRESS_1.toLowerCase()) {
    return 18 // ETH has 18 decimals
  }
  return 6 // Default for other tokens
}
