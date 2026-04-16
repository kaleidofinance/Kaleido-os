import { ADDRESS_1, kfUSD_ADDRESS, USDR } from "./addresses"
import { ethers } from "ethers"
export const getTokenDecimals = (tokenAddress: string) => {
  const addr = tokenAddress.toLowerCase()
  if (
    addr === ADDRESS_1.toLowerCase() ||
    addr === USDR.toLowerCase() ||
    addr === kfUSD_ADDRESS.toLowerCase()
  ) {
    return 18 // ETH, USDR, kfUSD have 18 decimals
  }
  return 6 // USDC, USDT have 6 decimals
}

export const correctFormattedAmount = (amount: string, tokenAddress: string): string => {
  const decimals = getTokenDecimals(tokenAddress)

  // Reconvert to raw wei (multiply by 10^18)
  const rawAmount = BigInt(amount)
  // console.log("Raw Amount:", amount)
  // console.log("converted Amount:", ethers.formatUnits(amount, decimals))

  // Reformat with correct decimals (e.g., 6 for USDC)
  const formatted = ethers.formatUnits(rawAmount, decimals)
  return Number(formatted).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })
}
