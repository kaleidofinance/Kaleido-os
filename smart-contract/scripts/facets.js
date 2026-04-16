const { ethers } = require("hardhat");



const diamondAddress = "0x4EE6eCAD1c2Dae9f525404De8555724e3c35d07B";
async function interactWithDiamond() {
  console.log("🔍 Interacting with Diamond Contract at:", diamondAddress);

  // Get an instance of the DiamondLoupeFacet
  const diamondLoupe = await ethers.getContractAt("IDiamondLoupe", diamondAddress);

  try {
    // Fetch facet addresses
    const facetAddresses = await diamondLoupe.facetAddresses();
    console.log("✅ Facet Addresses:", facetAddresses);

    // Fetch function selectors for each facet
    for (const address of facetAddresses) {
      console.log(`\n🔹 Fetching functions for facet: ${address}`);
      const functionSelectors = await diamondLoupe.facetFunctionSelectors(address);
      console.log("   Functions:", functionSelectors);
    }

    // Example: Calling the `owner()` function if OwnershipFacet is included
    try {
      const ownershipFacet = await ethers.getContractAt("IOwnershipFacet", diamondAddress);
      const owner = await ownershipFacet.owner();
      console.log("\n👑 Contract Owner:", owner);
    } catch (err) {
      console.log("⚠️ OwnershipFacet not found or 'owner()' function unavailable.");
    }
  } catch (error) {
    console.error("❌ Error interacting with Diamond Contract:", error);
  }
}

// Execute script
if (require.main === module) {

  interactWithDiamond(diamondAddress)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}

module.exports = { interactWithDiamond };
