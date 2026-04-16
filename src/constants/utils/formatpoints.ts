import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals"
import { ethers } from "ethers"
export function formatPoints(value: string | number, decimals = 2): string {
  let num: number

  if (typeof value === "string") {
    // Try to parse as BigInt or fallback to Number
    try {
      num = Number(BigInt(value))
    } catch {
      num = Number(value)
    }
  } else {
    num = value
  }

  if (isNaN(num)) return String(value)

  const absNum = Math.abs(num)

  if (absNum < 1_000) {
    return num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals })
  } else if (absNum < 1_000_000) {
    return (num / 1_000).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + "K"
  } else if (absNum < 1_000_000_000) {
    return (num / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + "M"
  } else if (absNum < 1_000_000_000_000) {
    return (num / 1_000_000_000).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + "B"
  } else {
    return (num / 1_000_000_000_000).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + "T"
  }
}

export const formatAmounts = (amount: number, tokenAddress: string, unfixed?: boolean) => {
  try {
    const decimals = getTokenDecimals(tokenAddress)

    // Handle different types of amount values
    let formattedAmountStr: string

    if (amount < 1 && amount > 0) {
      // Small decimal numbers (like 0.00000000019) are likely already in ether format
      // Don't try to format them with ethers.formatUnits as they can't be converted to BigInt
      formattedAmountStr = amount.toString()
    } else {
      // Large numbers are likely in wei format, so format them
      // Convert to string first to avoid BigInt conversion issues
      const amountStr = Math.floor(amount).toString()
      formattedAmountStr = ethers.formatUnits(amountStr, decimals)
    }

    const formattedAmountNum = Number(formattedAmountStr)

    if (unfixed) {
      return formattedAmountNum
    } else {
      return formattedAmountNum.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    }
  } catch (error) {
    // console.error(`Error formatting amount ${amount} for token ${tokenAddress}:`, error)

    if (unfixed) {
      return amount
    } else {
      return Number(amount).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    }
  }
}
