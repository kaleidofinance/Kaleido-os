const hre = require("hardhat");
const { ethers } = require("ethers");

/**
 * Script to complete kfUSD migration:
 * 1. Remove old kfUSD from YieldTreasury supported assets
 * 2. Revoke old kfUSD's YIELD_SOURCE_ROLE
 * 3. Verify new kfUSD is fully configured
 */

const CONTRACTS = {
  kfUSD: "0x913f3354942366809A05e89D288cCE60d87d7348", // Current/only kfUSD
  OLD_kfUSD: "0xf55C1Bc56618e9b47479b9B650A540Bc9b218ed1", // Deprecated
  YieldTreasury: "0x9977ac5FDdb3B3B8bB22d438b3177F8EA8d4A809",
};

const YieldTreasury_ABI = [
  "function getSupportedYieldAssets() view returns (address[])",
  "function setYieldAsset(address _asset, bool _supported) external",
  "function YIELD_SOURCE_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function setYieldSource(address _source, string memory _sourceName, bool _enabled) external",
];

async function main() {
  console.log("🔧 Completing kfUSD Migration...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log(`✅ Using account: ${deployer.address}\n`);

  const yieldTreasury = new ethers.Contract(CONTRACTS.YieldTreasury, YieldTreasury_ABI, deployer);

  try {
    // Check current state
    const supportedAssets = await yieldTreasury.getSupportedYieldAssets();
    const YIELD_SOURCE_ROLE = await yieldTreasury.YIELD_SOURCE_ROLE();
    
    const hasOldKfUSD = supportedAssets.some(a => a.toLowerCase() === CONTRACTS.OLD_kfUSD.toLowerCase());
    const hasNewKfUSD = supportedAssets.some(a => a.toLowerCase() === CONTRACTS.kfUSD.toLowerCase());
    const oldKfUSDHasRole = await yieldTreasury.hasRole(YIELD_SOURCE_ROLE, CONTRACTS.OLD_kfUSD);
    const newKfUSDHasRole = await yieldTreasury.hasRole(YIELD_SOURCE_ROLE, CONTRACTS.kfUSD);

    console.log("=".repeat(60));
    console.log("CURRENT STATE");
    console.log("=".repeat(60));
    console.log(`\n📦 Supported Assets: ${supportedAssets.length}`);
    console.log(`   Old kfUSD in assets: ${hasOldKfUSD}`);
    console.log(`   kfUSD in assets: ${hasNewKfUSD}`);
    console.log(`   Old kfUSD has role: ${oldKfUSDHasRole}`);
    console.log(`   kfUSD has role: ${newKfUSDHasRole}`);

    // Remove old kfUSD from supported assets
    if (hasOldKfUSD) {
      console.log("\n🗑️  Removing old kfUSD from supported assets...");
      const tx1 = await yieldTreasury.setYieldAsset(CONTRACTS.OLD_kfUSD, false);
      await tx1.wait();
      console.log(`   ✅ Removed old kfUSD from supported assets`);
    }

    // Revoke old kfUSD's role
    if (oldKfUSDHasRole) {
      console.log("\n🔐 Revoking old kfUSD's YIELD_SOURCE_ROLE...");
      const tx2 = await yieldTreasury.revokeRole(YIELD_SOURCE_ROLE, CONTRACTS.OLD_kfUSD);
      await tx2.wait();
      console.log(`   ✅ Revoked YIELD_SOURCE_ROLE from old kfUSD`);
    }

    // Disable old kfUSD as yield source
    try {
      console.log("\n🚫 Disabling old kfUSD as yield source...");
      const tx3 = await yieldTreasury.setYieldSource(CONTRACTS.OLD_kfUSD, "Deprecated kfUSD", false);
      await tx3.wait();
      console.log(`   ✅ Disabled old kfUSD as yield source`);
    } catch (error) {
      // Might not be registered, that's fine
      console.log(`   ℹ️  Old kfUSD not registered as yield source`);
    }

    // Ensure new kfUSD is properly configured
    if (!hasNewKfUSD) {
      console.log("\n➕ Adding kfUSD to supported assets...");
      const tx4 = await yieldTreasury.setYieldAsset(CONTRACTS.kfUSD, true);
      await tx4.wait();
      console.log(`   ✅ Added kfUSD to supported assets`);
    }

    if (!newKfUSDHasRole) {
      console.log("\n🔐 Granting YIELD_SOURCE_ROLE to kfUSD...");
      const tx5 = await yieldTreasury.grantRole(YIELD_SOURCE_ROLE, CONTRACTS.kfUSD);
      await tx5.wait();
      console.log(`   ✅ Granted YIELD_SOURCE_ROLE to kfUSD`);
    }

    // Ensure kfUSD is registered and enabled as yield source
    try {
      console.log("\n📝 Ensuring kfUSD is registered as yield source...");
      const tx6 = await yieldTreasury.setYieldSource(CONTRACTS.kfUSD, "kfUSD Fees", true);
      await tx6.wait();
      console.log(`   ✅ Registered kfUSD as yield source`);
    } catch (error) {
      // Might already be registered
      console.log(`   ℹ️  kfUSD already registered as yield source`);
    }

    // Final verification
    console.log("\n" + "=".repeat(60));
    console.log("FINAL VERIFICATION");
    console.log("=".repeat(60));
    
    const finalSupportedAssets = await yieldTreasury.getSupportedYieldAssets();
    const finalHasOldKfUSD = finalSupportedAssets.some(a => a.toLowerCase() === CONTRACTS.OLD_kfUSD.toLowerCase());
    const finalHasKfUSD = finalSupportedAssets.some(a => a.toLowerCase() === CONTRACTS.kfUSD.toLowerCase());
    const finalOldHasRole = await yieldTreasury.hasRole(YIELD_SOURCE_ROLE, CONTRACTS.OLD_kfUSD);
    const finalKfUSDHasRole = await yieldTreasury.hasRole(YIELD_SOURCE_ROLE, CONTRACTS.kfUSD);

    console.log(`\n✅ Final Status:`);
    console.log(`   Old kfUSD in assets: ${finalHasOldKfUSD} ${finalHasOldKfUSD ? '❌' : '✅'}`);
    console.log(`   kfUSD in assets: ${finalHasKfUSD} ${finalHasKfUSD ? '✅' : '❌'}`);
    console.log(`   Old kfUSD has role: ${finalOldHasRole} ${finalOldHasRole ? '❌' : '✅'}`);
    console.log(`   kfUSD has role: ${finalKfUSDHasRole} ${finalKfUSDHasRole ? '✅' : '❌'}`);

    if (!finalHasOldKfUSD && finalHasKfUSD && !finalOldHasRole && finalKfUSDHasRole) {
      console.log(`\n🎉 Migration complete! Only kfUSD (${CONTRACTS.kfUSD}) is configured.`);
      console.log(`\n✅ Configuration Summary:`);
      console.log(`   kfUSD Address: ${CONTRACTS.kfUSD}`);
      console.log(`   YieldTreasury: ${CONTRACTS.YieldTreasury}`);
      console.log(`   Status: Fully configured and ready`);
    } else {
      console.log(`\n⚠️  Some issues remain. Please review above.`);
    }

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

