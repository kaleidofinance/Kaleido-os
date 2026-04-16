const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("Checking kfUSD contract state with account:", deployer.address);

  // Get deployed contract addresses
  const deploymentFile = require('fs').readFileSync(
    require('fs').readdirSync('./').filter(f => f.startsWith('deployment-')).sort().reverse()[0]
  );
  const deployment = JSON.parse(deploymentFile);

  const kfUSDAddress = deployment.contracts.kfUSD;
  const USDC_ADDRESS = deployment.contracts.USDC;

  // Get contract instance
  const KfUSD = await hre.ethers.getContractFactory("kfUSD");
  const kfusd = KfUSD.attach(kfUSDAddress);

  console.log("\n=== kfUSD Contract State ===");
  
  // Check deployment ratio
  const deploymentRatio = await kfusd.deploymentRatio();
  console.log("Deployment Ratio:", deploymentRatio.toString(), "(" + (deploymentRatio / 100) + "%)");
  
  // Check auto-deployment
  const autoDeploymentEnabled = await kfusd.autoDeploymentEnabled();
  console.log("Auto-deployment Enabled:", autoDeploymentEnabled);
  
  // Check vault address
  const vaultAddress = await kfusd.vaultAddress();
  console.log("Vault Address:", vaultAddress);
  
  // Check USDC balances
  const [usdcIdle, usdcDeployed] = await kfusd.getBalances(USDC_ADDRESS);
  console.log("\nUSDC Idle Balance:", hre.ethers.formatUnits(usdcIdle, 6));
  console.log("USDC Deployed Balance:", hre.ethers.formatUnits(usdcDeployed, 6));
  
  const usdcCollateral = await kfusd.collateralBalances(USDC_ADDRESS);
  console.log("Total USDC Collateral:", hre.ethers.formatUnits(usdcCollateral, 6));
  
  // Check total minted
  const totalMinted = await kfusd.totalMinted();
  console.log("Total kfUSD Minted:", hre.ethers.formatUnits(totalMinted, 18));
  
  const totalSupply = await kfusd.totalSupply();
  console.log("kfUSD Total Supply:", hre.ethers.formatUnits(totalSupply, 18));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

