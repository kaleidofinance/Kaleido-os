const hre = require("hardhat");

/**
 * Script to configure YieldTreasury after deployment
 * This can be run separately if you need to add new yield sources or assets
 */
async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("Configuring YieldTreasury with account:", deployer.address);

  // Get deployed contract addresses from latest deployment file
  const fs = require('fs');
  const deploymentFiles = fs.readdirSync('./').filter(f => f.startsWith('deployment-') && f.endsWith('.json'));
  if (deploymentFiles.length === 0) {
    throw new Error("No deployment file found. Please deploy contracts first.");
  }
  
  const latestDeployment = deploymentFiles.sort().reverse()[0];
  const deployment = JSON.parse(fs.readFileSync(latestDeployment));
  
  console.log("Using deployment file:", latestDeployment);
  
  const yieldTreasuryAddress = deployment.contracts.YieldTreasury;
  const kfUSDAddress = deployment.contracts.kfUSD;
  const kafUSDAddress = deployment.contracts.kafUSD;
  
  if (!yieldTreasuryAddress) {
    throw new Error("YieldTreasury address not found in deployment file");
  }

  // Get contract instances
  const YieldTreasury = await hre.ethers.getContractFactory("YieldTreasury");
  const yieldTreasury = YieldTreasury.attach(yieldTreasuryAddress);

  console.log("\n=== Current YieldTreasury Configuration ===");
  
  // Check current kafUSD contract
  const currentKafUSD = await yieldTreasury.kafUSDContract();
  console.log("kafUSD Contract:", currentKafUSD);
  
  // Check supported yield assets
  const supportedAssets = await yieldTreasury.getSupportedYieldAssets();
  console.log("Supported Yield Assets:", supportedAssets);
  
  // Check yield sources
  const yieldSources = await yieldTreasury.getYieldSources();
  console.log("Yield Sources:", yieldSources);
  
  // Display yield source info
  for (const source of yieldSources) {
    const sourceInfo = await yieldTreasury.getYieldSourceInfo(source);
    console.log(`\nSource: ${source}`);
    console.log(`  Name: ${sourceInfo.sourceName}`);
    console.log(`  Enabled: ${sourceInfo.enabled}`);
    console.log(`  Total Contributed: ${hre.ethers.formatEther(sourceInfo.totalContributed)}`);
  }

  console.log("\n=== Configuration Options ===");
  console.log("1. Grant YIELD_SOURCE_ROLE to a contract");
  console.log("2. Register a new yield source");
  console.log("3. Add a supported yield asset");
  console.log("4. Check yield balances");
  
  // Example: Grant role to a vault contract (if you have one)
  // const vaultAddress = "0x...";
  // const YIELD_SOURCE_ROLE = await yieldTreasury.YIELD_SOURCE_ROLE();
  // await yieldTreasury.grantRole(YIELD_SOURCE_ROLE, vaultAddress);
  // await yieldTreasury.setYieldSource(vaultAddress, "Farming Rewards", true);
  // console.log("Granted YIELD_SOURCE_ROLE to vault and registered as yield source");
  
  // Example: Add KLD token as supported yield asset
  // const kldAddress = "0x...";
  // await yieldTreasury.setYieldAsset(kldAddress, true);
  // console.log("Added KLD as supported yield asset");
  
  // Check yield balances for each asset
  console.log("\n=== Yield Balances ===");
  for (const asset of supportedAssets) {
    const balance = await yieldTreasury.getYieldBalance(asset);
    const totalYield = await yieldTreasury.getTotalYield(asset);
    console.log(`Asset ${asset}:`);
    console.log(`  Current Balance: ${hre.ethers.formatEther(balance)}`);
    console.log(`  Total Accumulated: ${hre.ethers.formatEther(totalYield)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

