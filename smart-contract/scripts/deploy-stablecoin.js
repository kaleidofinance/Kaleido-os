const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // Deploy Tokens (USDT and USDe)
  console.log("\n=== Deploying Tokens ===");
  
  const USDT = await hre.ethers.getContractFactory("USDT");
  const usdt = await USDT.deploy(deployer.address);
  await usdt.waitForDeployment();
  console.log("USDT deployed to:", await usdt.getAddress());

  const USDe = await hre.ethers.getContractFactory("USDe");
  const usde = await USDe.deploy(deployer.address);
  await usde.waitForDeployment();
  console.log("USDe deployed to:", await usde.getAddress());

  // Get official USDC address (from dashboard configuration)
  // This is the official USDC address used in the Kaleido dashboard
  const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3";

  console.log("\nUsing USDC address:", USDC_ADDRESS);

  // Deploy kfUSD Stablecoin
  console.log("\n=== Deploying kfUSD Stablecoin ===");
  const KfUSD = await hre.ethers.getContractFactory("kfUSD");
  const kfusd = await KfUSD.deploy();
  await kfusd.waitForDeployment();
  const kfusdAddress = await kfusd.getAddress();
  console.log("kfUSD deployed to:", kfusdAddress);

  // Deploy kafUSD Liquid Staking Token
  console.log("\n=== Deploying kafUSD Liquid Staking Token ===");
  const KafUSD = await hre.ethers.getContractFactory("kafUSD");
  const kafusd = await KafUSD.deploy(kfusdAddress);
  await kafusd.waitForDeployment();
  const kafusdAddress = await kafusd.getAddress();
  console.log("kafUSD deployed to:", kafusdAddress);

  // Deploy YieldTreasury Contract
  console.log("\n=== Deploying YieldTreasury Contract ===");
  const YieldTreasury = await hre.ethers.getContractFactory("YieldTreasury");
  const yieldTreasury = await YieldTreasury.deploy(kafusdAddress);
  await yieldTreasury.waitForDeployment();
  const yieldTreasuryAddress = await yieldTreasury.getAddress();
  console.log("YieldTreasury deployed to:", yieldTreasuryAddress);

  // Configure YieldTreasury
  console.log("\n=== Configuring YieldTreasury ===");
  
  // Grant YIELD_SOURCE_ROLE to kfUSD contract
  const YIELD_SOURCE_ROLE = await yieldTreasury.YIELD_SOURCE_ROLE();
  await yieldTreasury.grantRole(YIELD_SOURCE_ROLE, kfusdAddress);
  console.log("Granted YIELD_SOURCE_ROLE to kfUSD contract");

  // Register kfUSD as yield source
  await yieldTreasury.setYieldSource(kfusdAddress, "kfUSD Fees", true);
  console.log("Registered kfUSD as yield source: 'kfUSD Fees'");

  // Add supported yield assets (kfUSD, USDC, USDT, USDe)
  const usdtAddress = await usdt.getAddress();
  const usdeAddress = await usde.getAddress();
  
  await yieldTreasury.setYieldAsset(kfusdAddress, true);
  console.log("Added kfUSD as supported yield asset");
  
  await yieldTreasury.setYieldAsset(USDC_ADDRESS, true);
  console.log("Added USDC as supported yield asset");
  
  await yieldTreasury.setYieldAsset(usdtAddress, true);
  console.log("Added USDT as supported yield asset");
  
  await yieldTreasury.setYieldAsset(usdeAddress, true);
  console.log("Added USDe as supported yield asset");

  // Configure kfUSD with YieldTreasury
  console.log("\n=== Configuring kfUSD with YieldTreasury ===");
  await kfusd.setYieldTreasury(yieldTreasuryAddress);
  console.log("Set YieldTreasury address in kfUSD contract");
  
  // Auto-transfer is enabled by default, but explicitly enable it here for clarity
  // Fees from mint & redeem will automatically be sent to YieldTreasury
  await kfusd.setAutoTransferFees(true);
  console.log("Automatic fee transfer to YieldTreasury enabled (fees auto-sent on mint/redeem)");

  // Configure kafUSD with YieldTreasury
  console.log("\n=== Configuring kafUSD with YieldTreasury ===");
  await kafusd.setYieldTreasury(yieldTreasuryAddress);
  console.log("Set YieldTreasury address in kafUSD contract");

  // Configure kfUSD with supported collaterals
  console.log("\n=== Configuring kfUSD Collaterals ===");

  // Add USDC as collateral
  await kfusd.setCollateralSupport(USDC_ADDRESS, true);
  console.log("Added USDC as collateral");

  // Add USDT as collateral
  await kfusd.setCollateralSupport(usdtAddress, true);
  console.log("Added USDT as collateral");

  // Add USDe as collateral
  await kfusd.setCollateralSupport(usdeAddress, true);
  console.log("Added USDe as collateral");

  // Grant MINTER_ROLE to kfUSD for minting
  const MINTER_ROLE = await kfusd.MINTER_ROLE();
  // You can add your own address or a multisig here
  console.log("\nMinter role can be granted later:", MINTER_ROLE);

  // Configure kafUSD with supported assets
  console.log("\n=== Configuring kafUSD Assets ===");
  
  // Add USDC as supported asset
  await kafusd.setAssetSupport(USDC_ADDRESS, true);
  console.log("Added USDC as supported asset");
  
  // Add kfUSD as supported asset
  await kafusd.setAssetSupport(kfusdAddress, true);
  console.log("Added kfUSD as supported asset");

  // Add collaterals as supported assets
  await kafusd.setAssetSupport(usdtAddress, true);
  console.log("Added USDT as supported asset");

  await kafusd.setAssetSupport(usdeAddress, true);
  console.log("Added USDe as supported asset");

  // Summary
  console.log("\n=== Deployment Summary ===");
  console.log("USDT:", await usdt.getAddress());
  console.log("USDe:", await usde.getAddress());
  console.log("kfUSD:", kfusdAddress);
  console.log("kafUSD:", kafusdAddress);
  console.log("YieldTreasury:", yieldTreasuryAddress);
  console.log("USDC:", USDC_ADDRESS);
  console.log("\nSupported Collaterals for kfUSD:");
  console.log("- USDC:", USDC_ADDRESS);
  console.log("- USDT:", await usdt.getAddress());
  console.log("- USDe:", await usde.getAddress());
  console.log("\nSupported Assets for kafUSD:");
  console.log("- USDC:", USDC_ADDRESS);
  console.log("- kfUSD:", kfusdAddress);
  console.log("- USDT:", await usdt.getAddress());
  console.log("- USDe:", await usde.getAddress());
  console.log("\nYieldTreasury Configuration:");
  console.log("- kfUSD registered as yield source: 'kfUSD Fees'");
  console.log("- Auto-transfer enabled in kfUSD");
  console.log("- Supported yield assets: kfUSD, USDC, USDT, USDe");

  // Save deployment info
  const network = await hre.ethers.provider.getNetwork();
  const deploymentInfo = {
    network: hre.network.name,
    chainId: network.chainId.toString(), // Convert BigInt to string
    deployer: deployer.address,
    contracts: {
      USDT: await usdt.getAddress(),
      USDe: await usde.getAddress(),
      kfUSD: kfusdAddress,
      kafUSD: kafusdAddress,
      YieldTreasury: yieldTreasuryAddress,
      USDC: USDC_ADDRESS
    },
    timestamps: {
      deployed: new Date().toISOString()
    }
  };

  const fs = require("fs");
  const filename = `deployment-${hre.network.name}-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
  console.log("\nDeployment info saved to:", filename);
  
  // Also save to a fixed filename for easy access
  const fixedFilename = `deployment-${hre.network.name}.json`;
  fs.writeFileSync(fixedFilename, JSON.stringify(deploymentInfo, null, 2));
  console.log("Deployment info also saved to:", fixedFilename);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

