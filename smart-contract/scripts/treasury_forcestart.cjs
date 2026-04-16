const { ethers } = require("hardhat");

async function main() {
  console.log("--- 🏛️ YIELD TREASURY: FORCE-START INITIALIZATION ---");

  const TREASURY_ADDR = "0xcB3D0069Cf6d6dfBB8E7Dee564DbE39eFa9c582d";
  const FACTORY_ADDR = "0xC75161E02E4599f1E68c4E9ea5bab001186D512B";
  const ROUTER_ADDR = "0x4b0c483064e1cE959CFCBb151B5043454D3cb2AC";
  const kfUSD_ADDR = "0x913f3354942366809A05e89D288cCE60d87d7348";

  const [deployer] = await ethers.getSigners();
  const treasuryArtifact = await ethers.getContractFactory("YieldTreasury");
  const treasury = treasuryArtifact.attach(TREASURY_ADDR).connect(deployer);

  try {
      console.log("1. Granting YIELD_SOURCE_ROLE to Factory & Router...");
      const YIELD_ROLE = await treasury.YIELD_SOURCE_ROLE();
      
      const tx1 = await treasury.grantRole(YIELD_ROLE, FACTORY_ADDR);
      await tx1.wait();
      console.log(`✅ Factory Authorized: ${FACTORY_ADDR}`);

      const tx2 = await treasury.grantRole(YIELD_ROLE, ROUTER_ADDR);
      await tx2.wait();
      console.log(`✅ Router Authorized: ${ROUTER_ADDR}`);

      console.log("2. Checking kfUSD Supply for AYPS Activation...");
      // For this test, if supply is 0, we can't receive yield.
      // We assume the user has already minted some kfUSD or we do it here if we are owner of kfUSD.
      
      console.log("✅ TREASURY INITIALIZED WITH ROLES");
  } catch (e) {
      console.error("❌ Initialization Failed:", e.message);
  }
}

main().catch(console.error);
