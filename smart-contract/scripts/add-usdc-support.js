const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("Adding USDC support to kafUSD with account:", deployer.address);
  
  // Get deployed contract addresses
  const deploymentFile = fs.readFileSync('deployment-abstractTestnet-1761557628558.json');
  const deployment = JSON.parse(deploymentFile);
  
  const kafUSDAddress = deployment.contracts.kafUSD;
  const USDC_ADDRESS = deployment.contracts.USDC;
  
  // Get contract instance
  const KafUSD = await hre.ethers.getContractFactory("kafUSD");
  const kafusd = KafUSD.attach(kafUSDAddress);
  
  console.log("kafUSD address:", kafUSDAddress);
  console.log("USDC address:", USDC_ADDRESS);
  
  // Add USDC support
  const tx = await kafusd.setAssetSupport(USDC_ADDRESS, true);
  console.log("Transaction hash:", tx.hash);
  
  await tx.wait();
  console.log("Successfully added USDC as supported asset for kafUSD");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

