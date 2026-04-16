// import { useEffect } from "react"
// import { ethers } from "ethers"
// import { HermesClient } from "@pythnetwork/hermes-client"
// import { envVars } from "@/constants/envVars"
// import pythAbi from "@/abi/PythOracle.json"

// const ETH_PYTH_FEED_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"
// const USDC_PYTH_FEED_ID = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a"

// const usePriceUpdater = () => {
//   useEffect(() => {
//     async function main() {
//       try {
//         // Setup provider & wallet
//         const provider = new ethers.JsonRpcProvider(envVars.httpRPCab)
//         const wallet = new ethers.Wallet(envVars.privateKey || "", provider)
//         const contract = new ethers.Contract(envVars.pythContractAddress || "", pythAbi, wallet)
//         const hermes = new HermesClient("https://hermes.pyth.network")
//         const fetchETH = await hermes.getLatestPriceUpdates([ETH_PYTH_FEED_ID])
//         const fetchUSDC = await hermes.getLatestPriceUpdates([USDC_PYTH_FEED_ID])

//         console.log("✅ Pyth price updates fetched", fetchETH)
//         console.log("✅ Pyth price updates fetched", fetchUSDC)

//         await updatePrice(contract, fetchETH, ETH_PYTH_FEED_ID)
//         await updatePrice(contract, fetchUSDC, USDC_PYTH_FEED_ID)
//       } catch (error) {
//         console.error("Error in usePriceUpdater:", error)
//       }
//     }

//     main()
//   }, [])

//   const updatePrice = async (contract: ethers.Contract, priceUpdate: any, feedId: string) => {
//     try {
//       const binaryData = priceUpdate.binary.data.map((hex: string) => "0x" + hex)

//       const tx = await contract.updatePrice(binaryData, feedId)

//       const receipt = await tx.wait()
//       console.log("Price Successfully updated:", receipt)
//     } catch (error) {
//       console.error("error updating price:", error)
//     }
//   }
// }

// export default usePriceUpdater
