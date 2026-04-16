import { SUPPORTED_CHAIN_ID } from "@/context/web3Modal"
import { getKaleidoContract } from "./contracts"
import { envVars } from "@/constants/envVars"

// Function to get the correct contract based on chainId
export const getContractByChainId = (signer: any, chainId: any) => {
  switch (chainId) {
    case SUPPORTED_CHAIN_ID[0]:
      return getKaleidoContract(signer)
    default:
      return getKaleidoContract(signer)
  }
}

export const getContractAddressesByChainId = (chainId: any) => {
  switch (chainId) {
    case SUPPORTED_CHAIN_ID[0]:
      return envVars.lendbitDiamondAddress
    default:
      return envVars.lendbitDiamondAddress
  }
}
