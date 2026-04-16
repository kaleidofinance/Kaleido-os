const { ethers } = require("hardhat");

async function main() {
  console.log("--- 🕵️ PREDATOR: MANUAL POOL GENESIS ---");

  // Master Stack Anchors
  const FACTORY_ADDR = "0xf1bfB54ce66A1Fa8Fe04fbf2f48119ffD3a5eDDD";
  const POSITION_MANAGER = "0x7F295e730C7c065ad102829f2e17556cF25a58C2";
  
  // High-Liquidity Targets
  const token0 = "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3"; // USDC
  const token1 = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // WETH
  const FEE = 3000;
  const sqrtPriceX96 = BigInt("79228162514264337593543950336"); // 1:1 price

  console.log(`Targeting Pair: USDC / WETH @ ${FEE/10000}% Fee`);
  
  // Artifact Resolution (Crucial for VM Dependencies)
  const poolArtifact = await ethers.getContractFactory("KaleidoSwapV3Pool");
  const managerArtifact = await ethers.getContractFactory("NonfungiblePositionManager");
  const factoryArtifact = await ethers.getContractFactory("KaleidoSwapV3Factory");

  const [deployer] = await ethers.getSigners();
  const manager = managerArtifact.attach(POSITION_MANAGER).connect(deployer);
  const factory = factoryArtifact.attach(FACTORY_ADDR).connect(deployer);

  try {
      console.log("Broadcasting Genesis with VM Bytecode Registration...");
      // We use the PositionManager to create AND initialize price atomically
      // On Abstract, we MUST ensure the TX includes the pool artifact as a dependency
      const tx = await manager.createAndInitializePoolIfNecessary(
          token0, token1, FEE, sqrtPriceX96, { 
              gasLimit: 30000000 
          }
      );
      
      console.log(`TX Broadcast Success: ${tx.hash}`);
      console.log("Awaiting Block Confirmation...");
      await tx.wait();
      
      const pool = await factory.getPool(token0, token1, FEE);
      console.log(`✅ VENUE ANCHORED: ${pool}`);
  } catch (e) {
      console.error("❌ Genesis Anchor Failed:", e.message);
      if (e.message.includes("is not supported")) {
          console.log("VM Sync Retry (Standard Mode)...");
          const retryTx = await manager.createAndInitializePoolIfNecessary(token0, token1, FEE, sqrtPriceX96, { gasLimit: 20000000 });
          await retryTx.wait();
          console.log("✅ Retry Success!");
      }
  }
}

main().catch(console.error);
