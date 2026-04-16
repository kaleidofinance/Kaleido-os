const { ethers } = require("hardhat");
const dotenv = require("dotenv");

dotenv.config();

async function main() {
  console.log("--- INITIATING SOVEREIGN DEPLOYMENT: HARDENED ONE-BY-ONE ---");

  const V3_FACTORY = process.env.V3_FACTORY;
  const WETH_ADDRESS = process.env.WETH_ADDRESS;
  const kfUSD_ADDRESS = process.env.kfUSD_ADDRESS;
  const TOKEN_DESCRIPTOR = process.env.TOKEN_DESCRIPTOR;
  const TARGET = process.env.DEPLOY_TARGET || "ALL";

  console.log("Configuration:");
  console.log("- V3_FACTORY:", V3_FACTORY);
  console.log("- WETH_ADDRESS:", WETH_ADDRESS);
  console.log("- kfUSD_ADDRESS:", kfUSD_ADDRESS);
  console.log("- DEPLOY_TARGET:", TARGET);

  if (!V3_FACTORY || !WETH_ADDRESS || !kfUSD_ADDRESS) {
      throw new Error("Missing required addresses in .env (V3_FACTORY, WETH_ADDRESS, or kfUSD_ADDRESS)");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // --- 1. DEPLOY HARDENED YIELD TREASURY ---
  if (TARGET === "ALL" || TARGET === "YIELD_TREASURY") {
      console.log("\n[1/4] Deploying Hardened YieldTreasury...");
      const YieldTreasury = await ethers.getContractFactory("YieldTreasury");
      // Passing kfUSD_ADDRESS as constructor argument
      const treasury = await YieldTreasury.deploy(kfUSD_ADDRESS);
      await treasury.waitForDeployment();
      console.log(`✅ YieldTreasury (Hardened): ${await treasury.getAddress()}`);
  } else {
      console.log("\n[1/4] Skipping YieldTreasury...");
  }

  // --- 2. DEPLOY STATELESS SWAP ROUTER ---
  if (TARGET === "ALL" || TARGET === "SWAP_ROUTER") {
      console.log("\n[2/4] Deploying Stateless SwapRouter...");
      const SwapRouter = await ethers.getContractFactory("SwapRouter");
      console.log("Expected Arguments:", SwapRouter.interface.deploy.inputs.map(i => i.name).join(", "));
      
      const router = await SwapRouter.deploy(V3_FACTORY, WETH_ADDRESS);
      await router.waitForDeployment();
      console.log(`✅ SwapRouter (Stateless): ${await router.getAddress()}`);
  } else {
      console.log("\n[2/4] Skipping SwapRouter...");
  }

  // --- 3. DEPLOY SYMMETRICAL NFTPOSITIONMANAGER ---
  if (TARGET === "ALL" || TARGET === "POSITION_MANAGER") {
      console.log("\n[3/4] Deploying Symmetrical NFTPositionManager...");
      const NFTPositionManager = await ethers.getContractFactory("NonfungiblePositionManager");
      const nftManager = await NFTPositionManager.deploy(
          V3_FACTORY, 
          WETH_ADDRESS, 
          TOKEN_DESCRIPTOR || "0x0000000000000000000000000000000000000000"
      );
      await nftManager.waitForDeployment();
      console.log(`✅ NFTPositionManager (Symmetrical): ${await nftManager.getAddress()}`);
  } else {
      console.log("\n[3/4] Skipping NFTPositionManager...");
  }

  // --- 4. DEPLOY PURE QUOTERV2 ---
  if (TARGET === "ALL" || TARGET === "QUOTER") {
      console.log("\n[4/4] Deploying Pure QuoterV2...");
      const QuoterV2 = await ethers.getContractFactory("QuoterV2");
      const quoter = await QuoterV2.deploy(V3_FACTORY, WETH_ADDRESS);
      await quoter.waitForDeployment();
      console.log(`✅ QuoterV2 (Pure): ${await quoter.getAddress()}`);
  } else {
      console.log("\n[4/4] Skipping QuoterV2...");
  }

  console.log("\n--- SOVEREIGN DEPLOYMENT SEQUENCE COMPLETE ---");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
