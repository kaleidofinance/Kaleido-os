const { ethers } = require("hardhat");

async function main() {
  console.log("--- 🐆 PREDATOR ANCHOR: FINAL GENESIS FORCE-PUSH ---");

  const FACTORY_ADDR = "0xf1bfB54ce66A1Fa8Fe04fbf2f48119ffD3a5eDDD";
  const POSITION_MANAGER = "0x7F295e730C7c065ad102829f2e17556cF25a58C2";
  
  const token0 = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // WETH
  const token1 = "0x913f3354942366809A05e89D288cCE60d87d7348"; // kfUSD
  const FEE = 3000;
  const sqrtPriceX96 = BigInt("79228162514264337593543950336");

  console.log("Bundling VM Dependencies...");
  const poolArtifact = await ethers.getContractFactory("KaleidoSwapV3Pool");
  const managerArtifact = await ethers.getContractFactory("NonfungiblePositionManager");
  const factoryArtifact = await ethers.getContractFactory("KaleidoSwapV3Factory");

  const [deployer] = await ethers.getSigners();
  const manager = managerArtifact.attach(POSITION_MANAGER).connect(deployer);
  const factory = factoryArtifact.attach(FACTORY_ADDR).connect(deployer);

  try {
      console.log("Broadcasting creation...");
      const tx = await manager.createAndInitializePoolIfNecessary(
          token0, token1, FEE, sqrtPriceX96, { 
              gasLimit: 30000000 
          }
      );
      await tx.wait();
      const pool = await factory.getPool(token0, token1, FEE);
      console.log(`✅ FINAL GENESIS SUCCESS: ${pool}`);
  } catch (e) {
      console.error("❌ Final Genesis Failed:", e.message);
  }
}

main().catch(console.error);
