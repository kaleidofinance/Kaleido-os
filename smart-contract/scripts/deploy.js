const { getSelectors, FacetCutAction } = require("./libraries/diamond.js");
const { ethers } = require("hardhat");

async function deployDiamond() {
  const accounts = await ethers.getSigners();

  if (accounts.length === 0) {
    throw new Error("❌ No accounts available. Check your Hardhat config.");
  }
  const contractOwner = accounts[0];
  console.log("👑 Deploying contract with account:", contractOwner.address);

  // Deploy DiamondCutFacet
  console.log("Deploying DiamondCutFacet...");
  const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
  const diamondCutFacet = await DiamondCutFacet.deploy({
    gasLimit: 3000000,
    // type: 2, // EIP-1559 transaction type
    // maxFeePerGas: ethers.parseUnits('40', 'gwei'),
    // maxPriorityFeePerGas: ethers.parseUnits('40', 'gwei'),
  });
  await diamondCutFacet.waitForDeployment();
  console.log("DiamondCutFacet deployed:", await diamondCutFacet.getAddress());

  // Deploy Diamond Contract
  console.log("Deploying Diamond Contract...");
  const Diamond = await ethers.getContractFactory("Diamond");
  const diamond = await Diamond.deploy(
    contractOwner.address,
    await diamondCutFacet.getAddress(),
    {
      gasLimit: 3000000,
      // type: 2,
      // maxFeePerGas: ethers.parseUnits('40', 'gwei'),
      // maxPriorityFeePerGas: ethers.parseUnits('40', 'gwei'),
    },
  );
  await diamond.waitForDeployment();
  console.log("Diamond deployed:", await diamond.getAddress());

  // Deploy DiamondInit
  console.log("Deploying Diamond Init Contract...");
  const DiamondInit = await ethers.getContractFactory("DiamondInit");
  const diamondInit = await DiamondInit.deploy({
    gasLimit: 3000000,
    type: 2,
    maxFeePerGas: ethers.parseUnits("40", "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits("40", "gwei"),
  });
  await diamondInit.waitForDeployment();
  console.log("DiamondInit deployed:", await diamondInit.getAddress());

  // Deploy Facets
  console.log("Deploying Diamond Facets...");
  const FacetNames = ["DiamondLoupeFacet", "OwnershipFacet", "ProtocolFacet"];
  const cut = [];

  for (const FacetName of FacetNames) {
    console.log(`Deploying ${FacetName}...`);
    const Facet = await ethers.getContractFactory(FacetName);
    const pythOracleMainnetAddress =
      "0x5B9853Aa298CEc2AB5F17237817b863f1DCeBAF9";
    const pythPriceOracleAddress = "0x0d50f180dc8ec83ffe820cdf1b142C77Af0Bf6aE";
    const kaleidovaultAddress = "0x1FDD717733CDf231C8E7e27def75A849673F9293";
    // Special handling for ProtocolFacet
    const deploymentOptions =
      FacetName === "ProtocolFacet"
        ? {
            //  pythPriceOracleAddress: pythPriceOracleAddress,
            gasLimit: 400000000, // Significantly increased gas limit
            // type: 2,
            // maxFeePerGas: ethers.parseUnits('40', 'gwei'),
            // maxPriorityFeePerGas: ethers.parseUnits('40', 'gwei'),
            // customData: {
            //   gasPerPubdataByteLimit: 80000
            // }
          }
        : {
            gasLimit: 50000000,
            // type: 2,
            // maxFeePerGas: ethers.parseUnits('40', 'gwei'),
            // maxPriorityFeePerGas: ethers.parseUnits('40', 'gwei'),
            // customData: {
            //   gasPerPubdataByteLimit: 80000
            // }
          };

    try {
      console.log(`Deploying ${FacetName} with options:`, deploymentOptions);
      let facet;
      if (FacetName === "ProtocolFacet") {
        facet = await Facet.deploy(deploymentOptions);
      } else {
        facet = await Facet.deploy(deploymentOptions);
      }
      console.log(
        `${FacetName} deployment transaction sent, waiting for confirmation...`,
      );

      // Add timeout for deployment
      const deploymentPromise = facet.waitForDeployment();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Deployment timeout after 300 seconds")),
          300000,
        ),
      );

      await Promise.race([deploymentPromise, timeoutPromise]);
      console.log(`${FacetName} deployed at: ${await facet.getAddress()}`);

      if (!facet.interface || !facet.interface.fragments) {
        console.error(
          `❌ Error: ${FacetName} contract.interface.fragments is undefined!`,
        );
        continue;
      }

      const functionSelectors = getSelectors(facet);
      if (functionSelectors.length === 0) {
        console.warn(`⚠️ Warning: ${FacetName} has no functions!`);
        continue;
      }

      console.log(`✅ ${FacetName} selectors:`, functionSelectors);

      cut.push({
        facetAddress: await facet.getAddress(),
        action: FacetCutAction.Add,
        functionSelectors,
      });
    } catch (error) {
      console.error(`❌ Failed to deploy ${FacetName}:`, error.message);
      throw error;
    }
  }

  // Perform Diamond Cut
  console.log("Executing Diamond Cut...");
  const diamondCut = await ethers.getContractAt(
    "IDiamondCut",
    await diamond.getAddress(),
  );

  const functionCall = diamondInit.interface.encodeFunctionData("init");
  const tx = await diamondCut.diamondCut(
    cut,
    await diamondInit.getAddress(),
    functionCall,
    {
      gasLimit: 40000000,
      // type: 2,
      // maxFeePerGas: ethers.parseUnits('40', 'gwei'),
      // maxPriorityFeePerGas: ethers.parseUnits('40', 'gwei'),
      // customData: { gasPerPubdataByteLimit: 80000 }
    },
  );
  console.log("Diamond cut tx: ", tx.hash);

  const receipt = await tx.wait();
  if (!receipt.status) {
    throw new Error(`Diamond upgrade failed: ${tx.hash}`);
  }

  console.log("✅ Diamond Cut Completed Successfully");

  // Verify that facets were added successfully
  const diamondLoupe = await ethers.getContractAt(
    "DiamondLoupeFacet",
    await diamond.getAddress(),
  );
  const facetAddresses = await diamondLoupe.facetAddresses();
  console.log("Facets added to Diamond:", facetAddresses);

  // Get all facets and their functions
  console.log("\nVerifying all facet functions:");
  for (const facetAddress of facetAddresses) {
    const functions = await diamondLoupe.facetFunctionSelectors(facetAddress);
    console.log(`\nFacet at ${facetAddress} functions:`);
    console.log(functions);
  }

  // Additional verification for ProtocolFacet
  try {
    const protocolFacet = await ethers.getContractAt(
      "ProtocolFacet",
      await diamond.getAddress(),
    );
    const protocolFunctions = await diamondLoupe.facetFunctionSelectors(
      await protocolFacet.getAddress(),
    );
    console.log("\nProtocolFacet functions registered:", protocolFunctions);

    if (protocolFunctions.length === 0) {
      // console.warn("⚠️ Warning: No ProtocolFacet functions were registered!");
      // Try to get the function selectors directly from the contract
      const protocolFacetContract =
        await ethers.getContractFactory("ProtocolFacet");
      const directSelectors = getSelectors(protocolFacetContract);
      console.log("Direct ProtocolFacet selectors:", directSelectors);
    }
  } catch (error) {
    console.error("Error verifying ProtocolFacet functions:", error);
  }

  return await diamond.getAddress();
}

// Execute Script
if (require.main === module) {
  deployDiamond()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Deployment failed:", error);
      process.exit(1);
    });
}

exports.deployDiamond = deployDiamond;
