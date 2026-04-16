// // Using your existing RPC setup to get all interacting addresses

// import { ethers } from "ethers"

// const getAddressesFromEventLogs = async (contractAddress, rpcManager) => {
//   try {
//     const { provider } = rpcManager.getNextProvider()

//     console.log(`🔍 Getting event logs for contract: ${contractAddress}`)

//     // Get all logs for the contract from deployment
//     const filter = {
//       address: contractAddress,
//       fromBlock: 0, // From contract deployment
//       toBlock: "latest",
//     }

//     console.log("📡 Fetching logs from RPC...")
//     const logs = await provider.getLogs(filter)
//     console.log(`📊 Found ${logs.length} total logs`)

//     if (logs.length === 0) {
//       console.log("⚠️ No logs found for this contract")
//       return []
//     }

//     const uniqueAddresses = new Set()
//     const transactionHashes = new Set()

//     // Extract addresses from event topics and transaction hashes
//     logs.forEach((log) => {
//       transactionHashes.add(log.transactionHash)

//       // Check topics for addresses (topics are indexed parameters)
//       log.topics.forEach((topic) => {
//         if (topic.length === 66) {
//           // 0x + 64 hex chars
//           // Try to extract address from topic (last 40 chars)
//           const potentialAddress = "0x" + topic.slice(-40)
//           if (ethers.isAddress(potentialAddress)) {
//             uniqueAddresses.add(potentialAddress.toLowerCase())
//           }
//         }
//       })
//     })

//     console.log(`🔗 Processing ${transactionHashes.size} unique transactions...`)

//     // Get transaction details for each unique transaction
//     let processedCount = 0
//     const batchSize = 50 // Process in batches to avoid overwhelming RPC
//     const txHashes = Array.from(transactionHashes)

//     for (let i = 0; i < txHashes.length; i += batchSize) {
//       const batch = txHashes.slice(i, i + batchSize)

//       const batchPromises = batch.map(async (hash) => {
//         try {
//           const tx = await provider.getTransaction(hash)
//           if (tx) {
//             uniqueAddresses.add(tx.from.toLowerCase())
//             if (tx.to) uniqueAddresses.add(tx.to.toLowerCase())
//           }
//         } catch (error) {
//           console.error(`❌ Error fetching tx ${hash}:`, error.message)
//         }
//       })

//       await Promise.allSettled(batchPromises)
//       processedCount += batch.length

//       console.log(`📈 Processed ${processedCount}/${txHashes.length} transactions`)

//       // Small delay between batches
//       if (i + batchSize < txHashes.length) {
//         await new Promise((resolve) => setTimeout(resolve, 100))
//       }
//     }

//     // Filter out contract address and zero address
//     const filteredAddresses = Array.from(uniqueAddresses).filter(
//       (addr) => addr !== contractAddress.toLowerCase() && addr !== "0x0000000000000000000000000000000000000000",
//     )

//     console.log(`✅ Found ${filteredAddresses.length} unique interacting addresses`)
//     return filteredAddresses
//   } catch (error) {
//     console.error("❌ Error getting addresses from event logs:", error)
//     return []
//   }
// }

// // Get addresses from specific event types (if you know the event signatures)
// const getAddressesFromSpecificEvents = async (contractAddress, rpcManager, eventSignatures = []) => {
//   try {
//     const { provider } = rpcManager.getNextProvider()

//     // Common DeFi event signatures
//     const defaultEventSignatures = [
//       "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", // Transfer
//       "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", // Approval
//       "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c", // Deposit
//       "0x884edad9ce6fa2440d8a54cc123490eb96d2768479d49ff9c7366125a9424364", // Withdraw
//       // Add your contract-specific event signatures here
//     ]

//     const signatures = eventSignatures.length > 0 ? eventSignatures : defaultEventSignatures
//     const uniqueAddresses = new Set()

//     for (const signature of signatures) {
//       try {
//         const filter = {
//           address: contractAddress,
//           topics: [signature],
//           fromBlock: 0,
//           toBlock: "latest",
//         }

//         const logs = await provider.getLogs(filter)
//         console.log(`📋 Found ${logs.length} logs for event ${signature}`)

//         // Process logs for this event
//         for (const log of logs) {
//           // Get transaction details
//           const tx = await provider.getTransaction(log.transactionHash)
//           if (tx) {
//             uniqueAddresses.add(tx.from.toLowerCase())
//             if (tx.to) uniqueAddresses.add(tx.to.toLowerCase())
//           }

//           // Extract addresses from topics
//           log.topics.forEach((topic) => {
//             if (topic.length === 66) {
//               const potentialAddress = "0x" + topic.slice(-40)
//               if (ethers.isAddress(potentialAddress)) {
//                 uniqueAddresses.add(potentialAddress.toLowerCase())
//               }
//             }
//           })
//         }
//       } catch (error) {
//         console.error(`❌ Error processing event ${signature}:`, error.message)
//       }
//     }

//     return Array.from(uniqueAddresses).filter(
//       (addr) => addr !== contractAddress.toLowerCase() && addr !== "0x0000000000000000000000000000000000000000",
//     )
//   } catch (error) {
//     console.error("❌ Error getting addresses from specific events:", error)
//     return []
//   }
// }

// // Integration with your existing bot
// const getAllInteractingAddressesForBot = async (rpcManager) => {
//   const contractAddress = "0x2aC60481a9EA2e67D80CdfBF587c63c88A5874ac"

//   console.log("🚀 Getting all addresses that interacted with the contract...")

//   try {
//     // Try event logs method first (most comprehensive)
//     const addresses = await getAddressesFromEventLogs(contractAddress, rpcManager)

//     if (addresses.length > 0) {
//       console.log(`✅ Successfully found ${addresses.length} addresses via event logs`)
//       return addresses
//     } else {
//       console.log("⚠️ No addresses found via event logs, trying specific events...")
//       return await getAddressesFromSpecificEvents(contractAddress, rpcManager)
//     }
//   } catch (error) {
//     console.error("❌ Failed to get addresses:", error)
//     return []
//   }
// }

// export { getAddressesFromEventLogs, getAddressesFromSpecificEvents, getAllInteractingAddressesForBot }
