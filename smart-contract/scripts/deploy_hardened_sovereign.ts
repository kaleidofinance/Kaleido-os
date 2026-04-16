import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("--- INITIATING SOVEREIGN DEPLOYMENT: ENVIRONMENT-DRIVEN ---");

  const V3_FACTORY = process.env.V3_FACTORY;
  const WETH_ADDRESS = process.env.WETH_ADDRESS;
  const TOKEN_DESCRIPTOR = process.env.TOKEN_DESCRIPTOR;

  if (!V3_FACTORY || !WETH_ADDRESS) {
      throw new Error("Missing V3_FACTORY or WETH_ADDRESS in .env");
  }

  // --- 1. DEPLOY HARDENED YIELD TREASURY ---
  console.log("Deploying Hardened YieldTreasury...");
  const YieldTreasury = await ethers.getContractFactory("YieldTreasury");
  const treasury = await YieldTreasury.deploy();
  await treasury.deployed();
  console.log(`✅ YieldTreasury (Hardened): ${treasury.address}`);

  // --- 2. DEPLOY STATELESS SWAP ROUTER ---
  console.log("Deploying Stateless SwapRouter...");
  const SwapRouter = await ethers.getContractFactory("SwapRouter");
  const router = await SwapRouter.deploy(V3_FACTORY, WETH_ADDRESS);
  await router.deployed();
  console.log(`✅ SwapRouter (Stateless): ${router.address}`);

  // --- 3. DEPLOY SYMMETRICAL NFTPOSITIONMANAGER ---
  console.log("Deploying Symmetrical NFTPositionManager...");
  const NFTPositionManager = await ethers.getContractFactory("NonfungiblePositionManager");
  const nftManager = await NFTPositionManager.deploy(V3_FACTORY, WETH_ADDRESS, TOKEN_DESCRIPTOR || ethers.constants.AddressZero);
  await nftManager.deployed();
  console.log(`✅ NFTPositionManager (Symmetrical): ${nftManager.address}`);

  // --- 4. DEPLOY PURE QUOTERV2 ---
  console.log("Deploying Pure QuoterV2...");
  const QuoterV2 = await ethers.getContractFactory("QuoterV2");
  const quoter = await QuoterV2.deploy(V3_FACTORY, WETH_ADDRESS);
  await quoter.deployed();
  console.log(`✅ QuoterV2 (Pure): ${quoter.address}`);

  console.log("--- SOVEREIGN DEPLOYMENT COMPLETE ---");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
