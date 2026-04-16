const { ethers } = require("hardhat");
const dotenv = require("dotenv");

dotenv.config();

async function main() {
  console.log("--- 🐆 INITIATING FULL SOVEREIGN REBOOT: CONTEXT SYNC ---");

  const WETH_ADDRESS = process.env.WETH_ADDRESS;
  const kfUSD_ADDRESS = process.env.kfUSD_ADDRESS;
  const TOKEN_DESCRIPTOR = "0x0000000000000000000000000000000000000000";

  const [deployer] = await ethers.getSigners();
  console.log("Deployer Account:", deployer.address);

  // 1. DEPLOY FRESH HARDENED V3 FACTORY
  console.log("\n[1/5] Deploying Sovereign V3 Factory...");
  const V3Factory = await ethers.getContractFactory("KaleidoSwapV3Factory");
  const factory = await V3Factory.deploy();
  await factory.waitForDeployment();
  const FACTORY_ADDR = await factory.getAddress();
  console.log(`✅ Factory Anchored: ${FACTORY_ADDR}`);

  // 2. DEPLOY STATELESS SWAP ROUTER
  console.log("\n[2/5] Deploying Stateless SwapRouter...");
  const SwapRouter = await ethers.getContractFactory("SwapRouter");
  const router = await SwapRouter.deploy(FACTORY_ADDR, WETH_ADDRESS);
  await router.waitForDeployment();
  console.log(`✅ SwapRouter Anchored: ${await router.getAddress()}`);

  // 3. DEPLOY SYMMETRICAL NFTPOSITIONMANAGER
  console.log("\n[3/5] Deploying Symmetrical NFTPositionManager...");
  const NFTPositionManager = await ethers.getContractFactory("NonfungiblePositionManager");
  const nftManager = await NFTPositionManager.deploy(FACTORY_ADDR, WETH_ADDRESS, TOKEN_DESCRIPTOR);
  await nftManager.waitForDeployment();
  console.log(`✅ NFTPositionManager Anchored: ${await nftManager.getAddress()}`);

  // 4. DEPLOY PURE QUOTERV2
  console.log("\n[4/5] Deploying Pure QuoterV2...");
  const QuoterV2 = await ethers.getContractFactory("QuoterV2");
  const quoter = await QuoterV2.deploy(FACTORY_ADDR, WETH_ADDRESS);
  await quoter.waitForDeployment();
  console.log(`✅ QuoterV2 Anchored: ${await quoter.getAddress()}`);

  // 5. ATOMIC POOL GENESIS
  console.log("\n[5/5] Creating kfUSD / WETH Pool Genesis...");
  const token0 = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // WETH
  const token1 = "0x913f3354942366809A05e89D288cCE60d87d7348"; // kfUSD
  const FEE = 3000;
  const sqrtPriceX96 = BigInt("79228162514264337593543950336");

  try {
      const tx = await nftManager.createAndInitializePoolIfNecessary(
          token0, token1, FEE, sqrtPriceX96, { gasLimit: 10000000 }
      );
      await tx.wait();
      const poolAddr = await factory.getPool(token0, token1, FEE);
      console.log(`✅ GENESIS SUCCESS! Pool at: ${poolAddr}`);
  } catch (e) {
      console.error("❌ Genesis Failed:", e.message);
  }

  console.log("\n--- SOVEREIGN FULL STACK COMPLETE ---");
  console.log("Updating local .env with new Factory...");
  // I will output the values for the user to see clearly
  console.log(`NEW_V3_FACTORY=${FACTORY_ADDR}`);
}

main().catch(console.error);
