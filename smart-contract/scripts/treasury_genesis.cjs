const { ethers } = require("hardhat");

async function main() {
  console.log("--- 🏛️ YIELD TREASURY: GENESIS INITIALIZATION ---");

  const TREASURY_ADDR = "0xcB3D0069Cf6d6dfBB8E7Dee564DbE39eFa9c582d";
  const kfUSD = "0x913f3354942366809A05e89D288cCE60d87d7348";
  const USDC = "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3";

  const factory = await ethers.getContractFactory("YieldTreasury");
  const [deployer] = await ethers.getSigners();
  const treasury = factory.attach(TREASURY_ADDR).connect(deployer);

  try {
      console.log("1. Authorizing kfUSD as Yield Asset...");
      const tx1 = await treasury.addYieldAsset(kfUSD);
      await tx1.wait();
      
      console.log("2. Authorizing USDC as Yield Asset...");
      const tx2 = await treasury.addYieldAsset(USDC);
      await tx2.wait();

      console.log("3. Mapping kfUSD Token Anchor...");
      // Also set kfUSDToken if the function exists
      try {
          const tx3 = await treasury.updateKafUSDContract(kfUSD);
          await tx3.wait();
      } catch(e) { /* Might be already set */ }

      console.log("✅ TREASURY GENESIS COMPLETE: AYPS OPERATIONAL");
  } catch (e) {
      console.error("❌ Initialization Failed:", e.message);
  }
}

main().catch(console.error);
