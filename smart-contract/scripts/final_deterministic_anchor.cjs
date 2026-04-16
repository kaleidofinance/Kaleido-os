const { ethers } = require("hardhat");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

async function main() {
  console.log("--- 🐆 FINAL DETERMINISTIC ANCHOR SEQUENCE ---");

  const WETH_ADDRESS = process.env.WETH_ADDRESS;
  const kfUSD_ADDRESS = process.env.kfUSD_ADDRESS;
  const TOKEN_DESCRIPTOR = "0x0000000000000000000000000000000000000000";

  const [deployer] = await ethers.getSigners();
  const stack = { deployer: deployer.address, timestamp: new Date().toISOString() };

  console.log("[1/5] Anchoring Factory...");
  const factory = await (await ethers.getContractFactory("KaleidoSwapV3Factory")).deploy();
  await factory.waitForDeployment();
  stack.factory = await factory.getAddress();

  console.log("[2/5] Anchoring Router...");
  const router = await (await ethers.getContractFactory("SwapRouter")).deploy(stack.factory, WETH_ADDRESS);
  await router.waitForDeployment();
  stack.router = await router.getAddress();

  console.log("[3/5] Anchoring Manager...");
  const nftManager = await (await ethers.getContractFactory("NonfungiblePositionManager")).deploy(stack.factory, WETH_ADDRESS, TOKEN_DESCRIPTOR);
  await nftManager.waitForDeployment();
  stack.manager = await nftManager.getAddress();

  console.log("[4/5] Anchoring Quoter...");
  const quoter = await (await ethers.getContractFactory("QuoterV2")).deploy(stack.factory, WETH_ADDRESS);
  await quoter.waitForDeployment();
  stack.quoter = await quoter.getAddress();

  console.log("[5/5] Anchoring Genesis Pool...");
  const token0 = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // WETH
  const token1 = "0x913f3354942366809A05e89D288cCE60d87d7348"; // kfUSD
  const FEE = 3000;
  const sqrtPriceX96 = BigInt("79228162514264337593543950336");

  try {
      const tx = await nftManager.createAndInitializePoolIfNecessary(token0, token1, FEE, sqrtPriceX96, { gasLimit: 15000000 });
      await tx.wait();
      stack.pool = await factory.getPool(token0, token1, FEE);
      console.log(`✅ Genesis Success: ${stack.pool}`);
  } catch (e) {
      console.log("Genesis Revert (Expected on VM). Use Dependency-Aware Step.");
      stack.pool = "REVERTED";
  }

  fs.writeFileSync("sovereign_stack.json", JSON.stringify(stack, null, 2));
  console.log("\n--- STACK PERSISTED TO sovereign_stack.json ---");
}

main().catch(console.error);
