const hre = require("hardhat");

/**
 * Script to check YieldTreasury state and user yields
 */
async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("Checking YieldTreasury with account:", deployer.address);

  // Get deployed contract addresses
  const fs = require('fs');
  const deploymentFiles = fs.readdirSync('./').filter(f => f.startsWith('deployment-') && f.endsWith('.json'));
  if (deploymentFiles.length === 0) {
    throw new Error("No deployment file found. Please deploy contracts first.");
  }
  
  const latestDeployment = deploymentFiles.sort().reverse()[0];
  const deployment = JSON.parse(fs.readFileSync(latestDeployment));
  
  const yieldTreasuryAddress = deployment.contracts.YieldTreasury;
  const kafUSDAddress = deployment.contracts.kafUSD;
  const userAddress = process.env.USER_ADDRESS || deployer.address;

  // Get contract instances
  const YieldTreasury = await hre.ethers.getContractFactory("YieldTreasury");
  const yieldTreasury = YieldTreasury.attach(yieldTreasuryAddress);
  
  const KafUSD = await hre.ethers.getContractFactory("kafUSD");
  const kafusd = KafUSD.attach(kafUSDAddress);

  console.log("\n=== YieldTreasury Info ===");
  console.log("Address:", yieldTreasuryAddress);
  console.log("kafUSD Contract:", await yieldTreasury.kafUSDContract());
  
  // Check supported yield assets
  const supportedAssets = await yieldTreasury.getSupportedYieldAssets();
  console.log("\n=== Supported Yield Assets ===");
  for (const asset of supportedAssets) {
    const balance = await yieldTreasury.getYieldBalance(asset);
    const totalYield = await yieldTreasury.getTotalYield(asset);
    console.log(`\n${asset}:`);
    console.log(`  Current Balance: ${hre.ethers.formatEther(balance)}`);
    console.log(`  Total Accumulated: ${hre.ethers.formatEther(totalYield)}`);
  }
  
  // Check yield sources
  const yieldSources = await yieldTreasury.getYieldSources();
  console.log("\n=== Yield Sources ===");
  for (const source of yieldSources) {
    const sourceInfo = await yieldTreasury.getYieldSourceInfo(source);
    console.log(`\n${source}:`);
    console.log(`  Name: ${sourceInfo.sourceName}`);
    console.log(`  Enabled: ${sourceInfo.enabled}`);
    console.log(`  Total Contributed: ${hre.ethers.formatEther(sourceInfo.totalContributed)}`);
  }
  
  // Check user's kafUSD balance
  const userKafUSDBalance = await kafusd.balanceOf(userAddress);
  console.log(`\n=== User Info (${userAddress}) ===`);
  console.log("kafUSD Balance:", hre.ethers.formatEther(userKafUSDBalance));
  
  // Check user's yield for each asset
  console.log("\n=== User's Available Yield ===");
  const [assets, amounts] = await yieldTreasury.calculateTotalUserYield(userAddress);
  
  for (let i = 0; i < assets.length; i++) {
    if (amounts[i] > 0) {
      console.log(`${assets[i]}: ${hre.ethers.formatEther(amounts[i])}`);
    }
  }
  
  // Check total kafUSD supply
  const totalSupply = await kafusd.totalSupply();
  console.log("\n=== kafUSD Supply ===");
  console.log("Total Supply:", hre.ethers.formatEther(totalSupply));
  console.log("User Share:", ((userKafUSDBalance * 10000n) / totalSupply) / 100, "%");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

