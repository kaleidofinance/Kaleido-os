const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("Setting deployment ratio with account:", deployer.address);

  // Get deployed contract addresses
  const deploymentFile = require('fs').readFileSync(
    // Find latest deployment file
    require('fs').readdirSync('./').filter(f => f.startsWith('deployment-')).sort().reverse()[0]
  );
  const deployment = JSON.parse(deploymentFile);

  const kfUSDAddress = deployment.contracts.kfUSD;

  // Get contract instance
  const KfUSD = await hre.ethers.getContractFactory("kfUSD");
  const kfusd = KfUSD.attach(kfUSDAddress);

  // Set deployment ratio to 0% (keep all collateral idle for redemptions)
  const tx = await kfusd.setDeploymentRatio(0);
  console.log("Setting deployment ratio to 0%...");
  await tx.wait();
  
  console.log("✅ Deployment ratio set to 0%");
  console.log("All collateral will now be kept idle for instant redemptions");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

