const { ethers } = require("hardhat");

async function main() {
  console.log("--- 🕵️ PREDATOR: DIRECT FACTORY GENESIS ANCHOR ---");

  const FACTORY_ADDR = "0xf1bfB54ce66A1Fa8Fe04fbf2f48119ffD3a5eDDD";
  const token0 = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // WETH
  const token1 = "0x913f3354942366809A05e89D288cCE60d87d7348"; // kfUSD
  const FEE = 3000;

  console.log(`Targeting Factory: ${FACTORY_ADDR}`);
  console.log(`Direct Genesis: WETH / kfUSD @ Fee ${FEE}`);
  
  // Artifact Resolution for Dependencies
  const poolArtifact = await ethers.getContractFactory("KaleidoSwapV3Pool");
  const factoryArtifact = await ethers.getContractFactory("KaleidoSwapV3Factory");

  const [deployer] = await ethers.getSigners();
  const factory = factoryArtifact.attach(FACTORY_ADDR).connect(deployer);

  try {
      console.log("Broadcasting Direct Anchor (50M Gas)...");
      // Calling createPool directly bypassing PositionManager
      const tx = await factory.createPool(token0, token1, FEE, { 
          gasLimit: 50000000 
      });
      
      console.log(`TX Sent: ${tx.hash}`);
      await tx.wait();
      
      const pool = await factory.getPool(token0, token1, FEE);
      console.log(`✅ DIRECT VENUE ANCHORED: ${pool}`);
  } catch (e) {
      console.error("❌ Direct Anchor Failed:", e.message);
  }
}

main().catch(console.error);
