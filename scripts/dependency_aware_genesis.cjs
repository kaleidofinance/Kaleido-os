const { ethers, network } = require("hardhat");
const dotenv = require("dotenv");

dotenv.config();

async function main() {
  console.log("--- 🐆 PREDATOR ANCHOR: DEPENDENCY-AWARE GENESIS ---");

  const FACTORY_ADDR = "0x0E88e0743d8b34c85F7401C01ec93a1b2d9413E4";
  const POSITION_MANAGER = "0x286395FeC6e232A856f6CEB46C38379B22B27EAb"; // This will be likely new if I rerun all, but I'll use our existing stack
  
  // Tokens
  const token0 = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // WETH
  const token1 = "0x913f3354942366809A05e89D288cCE60d87d7348"; // kfUSD
  const FEE = 3000;
  const sqrtPriceX96 = BigInt("79228162514264337593543950336");

  // On Abstract/ZKsync, we use specific deployment methods to ensure Factory Dependencies are included.
  // Since I am already in a Hardhat script, the 'zksolc' plugin should handle this IF the artifact is loaded.
  
  console.log("Loading Pool Artifact for VM Dependency registration...");
  const poolArtifact = await ethers.getContractFactory("KaleidoSwapV3Pool");
  const factoryArtifact = await ethers.getContractFactory("KaleidoSwapV3Factory");
  const managerArtifact = await ethers.getContractFactory("NonfungiblePositionManager");

  const [deployer] = await ethers.getSigners();
  const manager = managerArtifact.attach(POSITION_MANAGER).connect(deployer);

  console.log(`Executing Genesis for: ${token0} / ${token1} @ Fee ${FEE}`);

  try {
      // We use the already deployed manager to create the pool
      // The Hardhat environment here should automatically provide the bytecode hashes needed.
      const tx = await manager.createAndInitializePoolIfNecessary(
          token0, token1, FEE, sqrtPriceX96, { 
              gasLimit: 10000000,
              customData: {
                  factoryDeps: [ (await poolArtifact.getDeployTransaction()).data ]
              }
          }
      );
      console.log("Creation TX Sent:", tx.hash);
      await tx.wait();
      console.log("✅ GENESIS SUCCESS!");
  } catch (e) {
      console.error("❌ Genesis Failed:", e.message);
      if (e.message.includes("is not supported")) {
          console.log("Retrying without customData (Env fallback)...");
          const fallbackTx = await manager.createAndInitializePoolIfNecessary(token0, token1, FEE, sqrtPriceX96, { gasLimit: 15000000 });
          await fallbackTx.wait();
          console.log("✅ GENESIS SUCCESS (Fallback)!");
      }
  }
}

main().catch(console.error);
