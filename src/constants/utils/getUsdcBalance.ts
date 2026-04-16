import { readOnlyProvider } from "@/config/provider"
import { SUPPORTED_CHAIN_ID } from "@/context/web3Modal"
import { ethers } from "ethers"
import { kfUSD_ADDRESS, USDC_ADDRESS, USDC_ADDRESS_AB, USDR, USDT_ADDRESS } from "./addresses"

export const getProviderByChainId = (chainId: any) => {
  const id = Number(chainId);
  switch (id) {
    case 11124: // Abstract Testnet
      return readOnlyProvider;
    case 8453: // Base
      return new ethers.JsonRpcProvider("https://mainnet.base.org", { chainId: 8453, name: 'base' }, { staticNetwork: true });
    case 42161: // Arbitrum
      return new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc", { chainId: 42161, name: 'arbitrum' }, { staticNetwork: true });
    case 137: // Polygon
      return new ethers.JsonRpcProvider("https://polygon-rpc.com", { chainId: 137, name: 'polygon' }, { staticNetwork: true });
    case 1: // Mainnet
      return new ethers.JsonRpcProvider("https://cloudflare-eth.com", { chainId: 1, name: 'mainnet' }, { staticNetwork: true });
    case 999: // Hyperliquid EVM
      return new ethers.JsonRpcProvider("https://rpc.hyperliquid.xyz/evm", { chainId: 999, name: 'hyperliquid' }, { staticNetwork: true });
    default:
      return readOnlyProvider;
  }
}

// Function to get USDC address based on chain ID
export const getUsdcAddressByChainId = (chainId: any) => {
  switch (chainId) {
    case SUPPORTED_CHAIN_ID[0]: // Abstract Testnet
      return USDC_ADDRESS
    case SUPPORTED_CHAIN_ID[1]: // Sepolia
      return USDC_ADDRESS_AB
    default:
      return USDC_ADDRESS
  }
}

export const getUsdcBalance = async (address: string, chainId: any) => {
  const provider = getProviderByChainId(chainId)
  const usdcAddress = getUsdcAddressByChainId(chainId) // Get the correct USDC address

  const usdcontract = new ethers.Contract(
    usdcAddress,
    ["function balanceOf(address owner) view returns (uint256)"],
    provider,
  )

  const balance = await usdcontract.balanceOf(address)
  return ethers.formatUnits(balance, 6) // USDC typically has 6 decimals
}

export const getUsdRBalance = async (address: string, chainId: any) => {
  const provider = getProviderByChainId(chainId)

  const usdrcontract = new ethers.Contract(USDR, ["function balanceOf(address owner) view returns (uint256)"], provider)

  const balance = await usdrcontract.balanceOf(address)
  return ethers.formatUnits(balance, 18) // USDR has 18 decimals
}

export const getKfUSDBalance = async (address: string, chainId: any) => {
  const provider = getProviderByChainId(chainId)

  const kfusdcontract = new ethers.Contract(kfUSD_ADDRESS, ["function balanceOf(address owner) view returns (uint256)"], provider)

  const balance = await kfusdcontract.balanceOf(address)
  return ethers.formatUnits(balance, 18) // kfUSD has 18 decimals
}

export const getUSDTBalance = async (address: string, chainId: any) => {
  const provider = getProviderByChainId(chainId)

  const usdtcontract = new ethers.Contract(USDT_ADDRESS, ["function balanceOf(address owner) view returns (uint256)"], provider)

  const balance = await usdtcontract.balanceOf(address)
  return ethers.formatUnits(balance, 6) // USDT has 6 decimals
}
