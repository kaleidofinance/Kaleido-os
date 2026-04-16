import { ethers } from "ethers"
import kaleidoAbi from "@/abi/ProtocolFacet.json"
import erc20Abi from "@/abi/ERC20Abi.json"
import { envVars } from "@/constants/envVars"
import tokenFaucetAbi from "@/abi/TokenFaucet.json"
import KLDVaultAbi from "@/abi/KLDVaultAbi.json"

// Helper function to validate address and throw a clear error if missing
const validateAddress = (address: string | undefined, contractName: string): string => {
  if (!address || address.trim() === "") {
    throw new Error(
      `Missing contract address for ${contractName}. Please set the required environment variable (e.g., NEXT_PUBLIC_KALEIDO_DIAMOND_ADDRESS) in your .env file.`
    )
  }
  if (!ethers.isAddress(address)) {
    throw new Error(
      `Invalid contract address for ${contractName}: "${address}". Please check your environment variables.`
    )
  }
  return address
}

export const getKaleidoContract = (providerOrSigner: ethers.Provider | ethers.Signer) => {
  const address = validateAddress(envVars.lendbitDiamondAddress, "Kaleido Diamond")
  return new ethers.Contract(address, kaleidoAbi, providerOrSigner)
}

export const getTokenFaucetContract = (providerOrSigner: ethers.Provider | ethers.Signer) => {
  const address = validateAddress(envVars.faucetAddress, "Token Faucet")
  return new ethers.Contract(address, tokenFaucetAbi, providerOrSigner)
}

export const getKLDVaultContract = (providerOrSigner: ethers.Provider | ethers.Signer) => {
  const address = validateAddress(envVars.vaultAddress, "KLD Vault")
  return new ethers.Contract(address, KLDVaultAbi, providerOrSigner)
}

import KaleidoMasterChefAbi from "@/abi/KaleidoMasterChef.json"
export const getKaleidoMasterChefContract = (providerOrSigner: ethers.Provider | ethers.Signer) => {
  const address = validateAddress(envVars.masterChefAddress, "Kaleido MasterChef")
  return new ethers.Contract(address, KaleidoMasterChefAbi, providerOrSigner)
}

export const getProtocolContract = (providerOrSigner: ethers.Provider | ethers.Signer) => {
  const address = validateAddress(envVars.protocolAddress, "Protocol")
  return new ethers.Contract(address, kaleidoAbi, providerOrSigner)
}
// export const getMulticallContract = (providerOrSigner: ethers.Provider | ethers.Signer) =>
// new ethers.Contract(
//     envVars.multicallContract || "",
//     multicallAbi,
//     providerOrSigner
// );

export const getERC20Contract = (providerOrSigner: ethers.Provider | ethers.Signer, tokenAddress: string) =>
  new ethers.Contract(tokenAddress, erc20Abi, providerOrSigner)
