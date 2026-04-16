import { kfUSD_ADDRESS, USDC_ADDRESS, USDC_ADDRESS_AB, USDR, USDT_ADDRESS } from "./addresses"

// Sample token data for Base Sepolia
export const tokenData = [
  {
    token: "ETH",
    icon: "/eth.svg",
    tokenPrice: "0",
    // Hardcoded price
    address: "",
  },
  {
    token: "USDC",
    icon: "/USDC.svg",
    // tokenPrice: 1,
    address: USDC_ADDRESS,
  },
  {
    token: "USDR",
    icon: "/drakov4.png",
    address: USDR,
  },
  {
    token: "kfUSD",
    icon: "/stable/kfUSD.png",
    address: kfUSD_ADDRESS,
  },
  {
    token: "USDT",
    icon: "/usdt.svg",
    address: USDT_ADDRESS,
  },
]
