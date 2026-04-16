const { ethers } = require("hardhat");

async function addLoanableAssets() {
  try {
    const accounts = await ethers.getSigners();
    const DIAMOND_ADDRESS = "0x2aC60481a9EA2e67D80CdfBF587c63c88A5874ac";
    const diamond = await ethers.getContractAt(
      "ProtocolFacet",
      DIAMOND_ADDRESS,
    );

    // address USDT_USD = 0x3ec8593F930EA45ea58c968260e6e9FF53FC934f;
    // address WETH_USD = 0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1;
    // address DIA_USD = 0xD1092a65338d049DB68D7Be6bD89d17a0929945e;
    // address LINK_USD = 0xb113F5A928BCfF189C998ab20d753a47F9dE5A61;

    // address USDT_CONTRACT_ADDRESS = 0x00D1C02E008D594ebEFe3F3b7fd175850f96AEa0;
    // address WETH_CONTRACT_ADDRESS = 0x7fEa3ea63433a35e8516777171D7d0e038804716;
    // address DIA_CONTRACT_ADDRESS = 0x5caF98bf477CBE96d5CA56039FE7beec457bA653;
    // address LINK_CONTRACT_ADDRESS = 0xE4aB69C077896252FAFBD49EFD26B5D171A32410;
    //ETH
    //USDC
    //USDT
    const assets = [
      // "0x9EDCde0257F2386Ce177C3a7FCdd97787F0D841d", // WETH
      // "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3", // USDC
      // "0x0000000000000000000000000000000000000001", // Native Token (e.g., ETH)
      "0x769EBD1dc2470186f0a4911113754DfD13f2CDA3", //USDR
    ];

    const priceFeeds = [
      // "0x9d4294bbcd1174d6f2003ec365831e64cc31d9f6f15a2b85399db8d5000960f6", // ETH/USD
      // "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a", // USDC/USD
      // "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", // Native Token/USD
      "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a", //USDR/USD
    ];

    console.log("Adding collateral tokens...");
    const tx = await diamond.addCollateralTokens(assets, priceFeeds);
    console.log("Transaction sent, waiting for confirmation...");
    await tx.wait();
    console.log("Transaction confirmed!");

    // Verify the tokens were added
    const collateralTokens = await diamond.getAllCollateralToken();
    console.log("Current collateral tokens:", collateralTokens);

    // Add tokens as loanable
    console.log("\nAdding loanable tokens...");
    for (let i = 0; i < assets.length; i++) {
      console.log(`Adding ${assets[i]} as loanable token...`);
      const loanableTx = await diamond.addLoanableToken(
        assets[i],
        priceFeeds[i],
      );
      await loanableTx.wait();
      console.log(`Token ${assets[i]} added as loanable`);
    }

    console.log("\nInitialization completed successfully!");
  } catch (error) {
    console.error("Error during initialization:", error);
    throw error;
  }
}

async function main() {
  try {
    await addLoanableAssets();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
