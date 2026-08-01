/**
 * KaleidoSwap V3 Deployment Script
 * Deploys rebranded KaleidoSwap V3 contracts from source
 * Target: Abstract Testnet (Chain ID: 11124)
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

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

  // Pool init code hash. This is the keccak of the pool's creation bytecode,
  // and it is compiler-specific: zksolc (Abstract) and solc (every other
  // chain) produce different bytecode from identical source. PoolAddress.sol
  // hardcodes it, and the periphery authenticates swap callbacks against an
  // address derived from it — so a stale value does not fail here, it fails at
  // the first swap. Derive it from this build rather than trusting a literal.
  const poolArtifact = await hre.artifacts.readArtifact("KaleidoSwapV3Pool");
  const poolInitCodeHash = ethers.keccak256(poolArtifact.bytecode);
  console.log("   Pool init code hash (from this build):", poolInitCodeHash);

  if (!hre.network.config.zksync) {
    // EVM targets: the constant must agree with what we just compiled.
    // On zkSync the comparison is meaningless — CREATE2 derivation differs
    // there, so pools must be resolved via factory.getPool() regardless.
    const src = fs.readFileSync(
      path.join(__dirname, "..", "contracts", "dex-v3", "periphery", "libraries", "PoolAddress.sol"),
      "utf8",
    );
    const declared = (src.match(/POOL_INIT_CODE_HASH\s*=\s*(0x[0-9a-fA-F]{64})/) || [])[1];
    if (declared && declared.toLowerCase() !== poolInitCodeHash.toLowerCase()) {
      throw new Error(
        `POOL_INIT_CODE_HASH mismatch on ${hre.network.name}.\n` +
          `  PoolAddress.sol declares ${declared}\n` +
          `  this build produces      ${poolInitCodeHash}\n` +
          "Update the constant, recompile, and redeploy — otherwise every pool\n" +
          "address the router and position manager derive will be wrong.",
      );
    }
  }

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
