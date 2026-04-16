/**
 * KaleidoSwap V3 Deployment Script
 * Deploys rebranded KaleidoSwap V3 contracts from source
 * Target: Abstract Testnet (Chain ID: 11124)
 */

const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("🚀 Deploying KaleidoSwap V3 contracts...");
  console.log("✅ Deploying with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("   Balance:", ethers.formatEther(balance), "ETH");

  // Abstract Testnet WETH — same as used in V2 deployment
  const WETH_ADDRESS = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33";

  // 1. Deploy Factory
  console.log("\n📦 1. Deploying KaleidoSwapV3Factory...");
  const Factory = await ethers.getContractFactory("KaleidoSwapV3Factory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("✅ Factory deployed at:", factoryAddress);

  // Pool init code hash is a constant — fetch as property (ZKsync deploys may not expose it as a function)
  let poolInitCodeHash = "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";
  try {
    poolInitCodeHash = await factory.POOL_INIT_CODE_HASH();
  } catch (_) {
    console.log("   Pool init code hash (constant):", poolInitCodeHash);
  }
  console.log("   Pool init code hash:", poolInitCodeHash);

  // 3. Deploy SwapRouter
  console.log("\n📦 2. Deploying SwapRouter...");
  const SwapRouter = await ethers.getContractFactory("SwapRouter");
  const router = await SwapRouter.deploy(factoryAddress, WETH_ADDRESS);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log("✅ SwapRouter deployed at:", routerAddress);

  // 4. Deploy NFTDescriptor (library, required by PositionDescriptor)
  console.log("\n📦 3. Deploying NFTDescriptor...");
  const NFTDescriptor = await ethers.getContractFactory("NFTDescriptor");
  const nftDescriptor = await NFTDescriptor.deploy();
  await nftDescriptor.waitForDeployment();
  const nftDescriptorAddress = await nftDescriptor.getAddress();
  console.log("✅ NFTDescriptor deployed at:", nftDescriptorAddress);

  // 5. Deploy NonfungibleTokenPositionDescriptor (linked library)
  console.log("\n📦 4. Deploying NonfungibleTokenPositionDescriptor...");
  const nativeCurrencyLabelBytes = ethers.encodeBytes32String("ETH");
  const PositionDescriptor = await ethers.getContractFactory(
    "NonfungibleTokenPositionDescriptor",
    {
      libraries: {
        NFTDescriptor: nftDescriptorAddress,
      },
    }
  );
  const positionDescriptor = await PositionDescriptor.deploy(
    WETH_ADDRESS,
    nativeCurrencyLabelBytes
  );
  await positionDescriptor.waitForDeployment();
  const positionDescriptorAddress = await positionDescriptor.getAddress();
  console.log("✅ PositionDescriptor deployed at:", positionDescriptorAddress);

  // 6. Deploy NonfungiblePositionManager
  console.log("\n📦 5. Deploying NonfungiblePositionManager...");
  const PositionManager = await ethers.getContractFactory(
    "NonfungiblePositionManager"
  );
  const positionManager = await PositionManager.deploy(
    factoryAddress,
    WETH_ADDRESS,
    positionDescriptorAddress
  );
  await positionManager.waitForDeployment();
  const positionManagerAddress = await positionManager.getAddress();
  console.log("✅ PositionManager deployed at:", positionManagerAddress);

  // 7. Deploy Quoter
  console.log("\n📦 6. Deploying Quoter...");
  const Quoter = await ethers.getContractFactory("Quoter");
  const quoter = await Quoter.deploy(factoryAddress, WETH_ADDRESS);
  await quoter.waitForDeployment();
  const quoterAddress = await quoter.getAddress();
  console.log("✅ Quoter deployed at:", quoterAddress);

  // Save deployment addresses
  const timestamp = Date.now();
  const deployment = {
    network: "abstractTestnet",
    chainId: 11124,
    timestamp: new Date().toISOString(),
    contracts: {
      factory: factoryAddress,
      router: routerAddress,
      positionManager: positionManagerAddress,
      positionDescriptor: positionDescriptorAddress,
      nftDescriptor: nftDescriptorAddress,
      quoter: quoterAddress,
      weth: WETH_ADDRESS,
      poolInitCodeHash: poolInitCodeHash,
    },
  };

  const outFile = `deployment-v3-abstractTestnet-${timestamp}.json`;
  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2));

  console.log("\n============================================================");
  console.log("✅ DEPLOYMENT SUMMARY");
  console.log("============================================================");
  console.log("Factory:          ", factoryAddress);
  console.log("SwapRouter:       ", routerAddress);
  console.log("PositionManager:  ", positionManagerAddress);
  console.log("Quoter:           ", quoterAddress);
  console.log("WETH:             ", WETH_ADDRESS);
  console.log("\n⚠️  IMPORTANT: Update frontend with new V3 addresses!");
  console.log("📋 Full addresses saved to:", outFile);
  console.log("============================================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
