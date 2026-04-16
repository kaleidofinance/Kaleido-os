import { readOnlyProvider } from "@/config/provider"
import { SUPPORTED_CHAIN_ID } from "@/context/web3Modal"
import { ethers } from "ethers"
import KLDVaultAbi from "@/abi/KLDVaultAbi.json"
import { getKLDVaultContract } from "@/config/contracts"
import { KLD_ADDRESS, stKLD_ADDRESS } from "./addresses"

// Function to select the appropriate provider based on the chain ID
const getProviderByChainId = (chainId: any) => {
  switch (chainId) {
    case SUPPORTED_CHAIN_ID[0]:
      return readOnlyProvider
    default:
      throw new Error("Unsupported chain ID")
  }
}

export const getEthBalance = async (address: string, chainId: any) => {
  const provider = getProviderByChainId(chainId)
  const balance = await provider.getBalance(address)
  const balanceInEth = ethers.formatEther(balance)
  return parseFloat(balanceInEth).toFixed(3)
}

// export const getstKLDBalance = async (tokenAddress: string): Promise<number> => {
//   const contract = getKLDVaultContract(readOnlyProvider)
//   const userKldBalance = await contract.getUserTokenBalance(tokenAddress)
//   return userKldBalance
// }

export const getKLDBalance = async (address: string): Promise<string> => {
  try {
    const contract = new ethers.Contract(
      KLD_ADDRESS,
      ["function balanceOf(address owner) view returns (uint256)"],
      readOnlyProvider,
    )

    const balance = await contract.balanceOf(address)
    // console.log("Token balane", balance)
    return ethers.formatUnits(balance, 18)
  } catch (error) {
    // console.log("Error fetching user KLD balance:", error)
    throw new Error("Error fetching user KLD balance")
  }
}

export const getstKLDBalance = async (address: string): Promise<string> => {
  try {
    const contract = new ethers.Contract(
      stKLD_ADDRESS,
      ["function balanceOf(address owner) view returns (uint256)"],
      readOnlyProvider,
    )

    const balance = await contract.balanceOf(address)
    // console.log("Token balane", balance)
    return ethers.formatUnits(balance, 18)
  } catch (error) {
    // console.log("Error fetching user stKLD balance:", error)
    throw new Error("Error fetching user stKLD balance")
  }
}
