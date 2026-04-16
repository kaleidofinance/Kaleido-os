const { ethers } = require("hardhat");

async function main() {
  console.log("--- 🕵️ PREDATOR: DEFINITIVE OPTIMIZED GENESIS ---");

  const FACTORY_ADDR = "0xC75161E02E4599f1E68c4E9ea5bab001186D512B";
  const token0 = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // WETH
  const token1 = "0x913f3354942366809A05e89D288cCE60d87d7348"; // kfUSD
  const FEE = 3000;

  console.log(`Targeting Factory (1.5.15): ${FACTORY_ADDR}`);
  
  const factoryArtifact = await ethers.getContractFactory("KaleidoSwapV3Factory");
  const [deployer] = await ethers.getSigners();
  const factory = factoryArtifact.attach(FACTORY_ADDR).connect(deployer);

  try {
      console.log("Broadcasting Deterministic Genesis...");
      const tx = await factory.createPool(token0, token1, FEE, { 
          gasLimit: 30000000 
      });
      
      console.log(`TX Sent: ${tx.hash}`);
      await tx.wait();
      
      const pool = await factory.getPool(token0, token1, FEE);
      console.log(`✅ DEFINITIVE VENUE ANCHORED: ${pool}`);
  } catch (e) {
      console.error("❌ Optimized Genesis Failed:", e.message);
  }
}

main().catch(console.error);
