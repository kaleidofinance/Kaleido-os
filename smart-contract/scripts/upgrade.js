const fs = require("fs");
const { getSelectors, FacetCutAction } = require("./libraries/diamond.js");
const { ethers } = require("hardhat");

async function upgradeProtocolFacet() {
  const [contractOwner] = await ethers.getSigners();

  // Configuration - Update these!
  const DIAMOND_ADDRESS = "0x2aC60481a9EA2e67D80CdfBF587c63c88A5874ac";
  const DIAMOND_INIT_ADDRESS = "0xb66a5C231ACA7C8C458D3E95042b21851FD52134";
  const OLD_PROTOCOL_FACET_ADDRESS =
    "0x2526A4C609252147863d258DBf26fBa06743311f";

  console.log(`\n🔄 Starting Protocol Facet Upgrade...`);
  console.log(`Diamond Address: ${DIAMOND_ADDRESS}`);
  console.log(`Deployer: ${contractOwner.address}`);

  // ✅ 1. Validate current state before upgrade (improved validation)
  console.log("\n1. Validating current diamond state...");
  try {
    // Use DiamondLoupe to check if diamond is responsive
    const loupe = await ethers.getContractAt("IDiamondLoupe", DIAMOND_ADDRESS);
    const facets = await loupe.facets();
    console.log(`✅ Diamond is responsive. Found ${facets.length} facets`);

    // Log current facets for debugging
    facets.forEach((facet, index) => {
      console.log(
        `   Facet ${index + 1}: ${facet.facetAddress} (${facet.functionSelectors.length} functions)`,
      );
    });

    // Try to get a contract instance with just basic diamond functions
    const diamond = await ethers.getContractAt(
      [
        "function owner() view returns (address)",
        "function facets() view returns (tuple(address facetAddress, bytes4[] functionSelectors)[])",
      ],
      DIAMOND_ADDRESS,
    );

    // Test basic diamond functionality
    try {
      const owner = await diamond.owner();
      console.log(`✅ Diamond owner: ${owner}`);
    } catch (ownerError) {
      console.log("⚠️  No owner function found, continuing...");
    }

    // Check if ProtocolFacet functions exist by looking at selectors
    const protocolFacetInstance =
      await ethers.getContractFactory("ProtocolFacet");
    const expectedSelectors = getSelectors(protocolFacetInstance);
    const allCurrentSelectors = facets.flatMap((f) => f.functionSelectors);

    const existingProtocolSelectors = expectedSelectors.filter((sel) =>
      allCurrentSelectors.includes(sel),
    );

    console.log(
      `✅ Found ${existingProtocolSelectors.length}/${expectedSelectors.length} expected ProtocolFacet functions`,
    );
  } catch (error) {
    console.error("❌ Diamond validation failed:", error.message);
    throw error;
  }

  // ✅ 2. Deploy new facet with verification and proper gas limit
  console.log("\n2. Deploying new ProtocolFacet...");
  const ProtocolFacet = await ethers.getContractFactory("ProtocolFacet");

  let newProtocolFacet;
  let newFacetAddress;

  try {
    // First try to estimate gas for deployment
    const deploymentData = ProtocolFacet.bytecode;
    const provider = ethers.provider;

    try {
      const gasEstimate = await provider.estimateGas({
        data: deploymentData,
      });
      console.log(`⛽ Estimated deployment gas: ${gasEstimate.toString()}`);

      // Use estimated gas with 30% buffer for deployment
      const deploymentGasLimit = (gasEstimate * 130n) / 100n;
      console.log(
        `⛽ Using deployment gas limit: ${deploymentGasLimit.toString()}`,
      );

      newProtocolFacet = await ProtocolFacet.deploy({
        gasLimit: deploymentGasLimit,
      });
    } catch (estimateError) {
      console.log("⚠️  Could not estimate gas, using higher fixed limit...");
      // Fallback to a higher fixed gas limit
      newProtocolFacet = await ProtocolFacet.deploy({
        gasLimit: 8000000, // 8M gas limit
      });
    }

    await newProtocolFacet.waitForDeployment();
    newFacetAddress = await newProtocolFacet.getAddress();
    console.log(`✅ New ProtocolFacet deployed at: ${newFacetAddress}`);
  } catch (deployError) {
    console.error("❌ Failed to deploy ProtocolFacet:", deployError.message);
    if (deployError.reason) {
      console.error("Reason:", deployError.reason);
    }
    throw deployError;
  }

  // ✅ 3. Compare selectors
  const newSelectors = getSelectors(newProtocolFacet);
  console.log(`New facet has ${newSelectors.length} functions`);

  // Get currently active selectors on the Diamond
  const loupe = await ethers.getContractAt("IDiamondLoupe", DIAMOND_ADDRESS);
  const currentFacets = await loupe.facets();
  const activeSelectors = currentFacets.flatMap((f) => f.functionSelectors);

  // Filter selectors
  const replaceSelectors = newSelectors.filter((sel) =>
    activeSelectors.includes(sel),
  );
  const addSelectors = newSelectors.filter(
    (sel) => !activeSelectors.includes(sel),
  );

  console.log(`Selectors to replace: ${replaceSelectors.length}`);
  console.log(`Selectors to add: ${addSelectors.length}`);

  // Log specific selectors for debugging
  if (replaceSelectors.length > 0) {
    console.log(
      `Replace selectors: ${replaceSelectors.map((s) => s.slice(0, 10)).join(", ")}`,
    );
  }
  if (addSelectors.length > 0) {
    console.log(
      `Add selectors: ${addSelectors.map((s) => s.slice(0, 10)).join(", ")}`,
    );
  }

  // ✅ 4. Build diamond cut operations
  const cut = [];

  if (replaceSelectors.length > 0) {
    cut.push({
      facetAddress: newFacetAddress,
      action: FacetCutAction.Replace,
      functionSelectors: replaceSelectors,
    });
  }

  if (addSelectors.length > 0) {
    cut.push({
      facetAddress: newFacetAddress,
      action: FacetCutAction.Add,
      functionSelectors: addSelectors,
    });
  }

  if (cut.length === 0) {
    console.log("❌ No changes to apply. Exiting...");
    return;
  }

  // ✅ 5. Save ABI for frontend
  console.log("\n3. Saving ABI...");
  try {
    // Ensure directory exists
    const abiDir = "./scripts/abi";
    if (!fs.existsSync(abiDir)) {
      fs.mkdirSync(abiDir, { recursive: true });
    }

    fs.writeFileSync(
      "./scripts/abi/ProtocolFacet.json",
      JSON.stringify(JSON.parse(ProtocolFacet.interface.formatJson()), null, 2),
    );
    console.log("✅ ABI saved successfully");
  } catch (error) {
    console.error("⚠️  Failed to save ABI (continuing anyway):", error.message);
  }

  // ✅ 6. Execute upgrade with proper error handling
  console.log("\n4. Executing diamondCut...");
  const diamondCut = await ethers.getContractAt("IDiamondCut", DIAMOND_ADDRESS);

  try {
    // Estimate gas first
    const gasEstimate = await diamondCut.diamondCut.estimateGas(
      cut,
      ethers.ZeroAddress,
      "0x",
    );
    console.log(`⛽ Estimated diamondCut gas: ${gasEstimate.toString()}`);

    // Execute with calculated buffer (20% more than estimate)
    const gasWithBuffer = (gasEstimate * 120n) / 100n;
    console.log(`⛽ Using diamondCut gas limit: ${gasWithBuffer.toString()}`);

    const tx = await diamondCut.diamondCut(
      cut,
      ethers.ZeroAddress, // No init contract needed for simple upgrades
      "0x", // Empty init data
      {
        gasLimit: gasWithBuffer,
      },
    );

    console.log(`⏳ Transaction hash: ${tx.hash}`);
    const receipt = await tx.wait();

    if (!receipt.status) {
      throw new Error(`Upgrade transaction failed: ${tx.hash}`);
    }

    console.log(
      `✅ Upgrade transaction confirmed in block ${receipt.blockNumber}`,
    );
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
  } catch (error) {
    console.error("❌ Diamond cut failed:", error.message);

    // Enhanced error logging
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    if (error.data) {
      console.error("Error data:", error.data);
    }

    throw error;
  }

  // ✅ 7. Verify upgrade worked (improved verification)
  console.log("\n5. Verifying upgrade...");
  try {
    const loupe = await ethers.getContractAt("IDiamondLoupe", DIAMOND_ADDRESS);
    const updatedFacets = await loupe.facets();
    const updatedSelectors = updatedFacets.flatMap((f) => f.functionSelectors);

    // Verify all new selectors are now active
    const missingSelectors = newSelectors.filter(
      (sel) => !updatedSelectors.includes(sel),
    );

    if (missingSelectors.length > 0) {
      console.error(
        `❌ Missing selectors after upgrade: ${missingSelectors.length}`,
      );
      console.error(
        "Missing selectors:",
        missingSelectors.map((s) => s.slice(0, 10)).join(", "),
      );
      throw new Error("Some selectors were not properly added");
    }

    console.log(
      `✅ All ${newSelectors.length} selectors are now active on the diamond`,
    );

    // Find the facet that contains our new functions
    const protocolFacet = updatedFacets.find(
      (f) => f.facetAddress.toLowerCase() === newFacetAddress.toLowerCase(),
    );

    if (protocolFacet) {
      console.log(
        `✅ New ProtocolFacet registered with ${protocolFacet.functionSelectors.length} functions`,
      );
    }

    // Show updated facet summary
    console.log(`\n📊 Updated Diamond State:`);
    updatedFacets.forEach((facet, index) => {
      const isNew =
        facet.facetAddress.toLowerCase() === newFacetAddress.toLowerCase();
      const marker = isNew ? "🆕" : "  ";
      console.log(
        `${marker} Facet ${index + 1}: ${facet.facetAddress} (${facet.functionSelectors.length} functions)`,
      );
    });
  } catch (error) {
    console.error("❌ Post-upgrade verification failed:", error.message);
    throw error;
  }

  console.log("\n🎉 Upgrade completed successfully!");
  console.log(`📋 Summary:`);
  console.log(`   - Diamond: ${DIAMOND_ADDRESS}`);
  console.log(`   - New Facet: ${newFacetAddress}`);
  console.log(`   - Functions Replaced: ${replaceSelectors.length}`);
  console.log(`   - Functions Added: ${addSelectors.length}`);

  return {
    diamondAddress: DIAMOND_ADDRESS,
    newFacetAddress: newFacetAddress,
    replacedFunctions: replaceSelectors.length,
    addedFunctions: addSelectors.length,
  };
}

if (require.main === module) {
  upgradeProtocolFacet()
    .then((result) => {
      console.log("\n✅ Script completed successfully:", result);
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Upgrade failed:", error);
      process.exit(1);
    });
}

exports.upgradeProtocolFacet = upgradeProtocolFacet;
