const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Deploy ownerless ZeroAutoBridge on any EVM source chain with canonical $ZRO OFT.
 *
 * Usage:
 *   FEE_RECIPIENT=0xYourTreasury npx hardhat run scripts/deploy-zero-autobridge.js --network base
 */
async function main() {
  const ZRO_OFT = process.env.ZRO_OFT_ADDRESS || "0x6985884C4392D348587b19cb9eAAf157f13271cd";
  const ZERO_DST_EID = Number(process.env.ZERO_DST_EID || "33002");
  const FEE_BPS = Number(process.env.ZERO_BRIDGE_FEE_BPS || "25"); // 0.25%

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer signer configured for network " + hre.network.name);
  }
  const feeRecipient = process.env.FEE_RECIPIENT || deployer.address;

  console.log("Deploying ZeroAutoBridge on", hre.network.name);
  console.log("  Deployer:     ", deployer.address);
  console.log("  ZRO OFT:      ", ZRO_OFT);
  console.log("  Zero dstEid:  ", ZERO_DST_EID);
  console.log("  Fee Recipient:", feeRecipient);
  console.log("  Fee BPS:      ", FEE_BPS, `(${FEE_BPS / 100}%)`);

  const Bridge = await hre.ethers.getContractFactory("ZeroAutoBridge");
  const bridge = await Bridge.deploy(ZRO_OFT, ZERO_DST_EID, feeRecipient, FEE_BPS);
  await bridge.waitForDeployment();

  const address = await bridge.getAddress();
  const net = await hre.ethers.provider.getNetwork();
  console.log("\nZeroAutoBridge deployed at:", address);

  const outPath = path.join(
    __dirname,
    "..",
    `deployment-zero-autobridge-${hre.network.name}.json`,
  );
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        contract: "ZeroAutoBridge",
        network: hre.network.name,
        chainId: Number(net.chainId),
        address,
        zroOft: ZRO_OFT,
        dstEid: ZERO_DST_EID,
        feeRecipient,
        feeBps: FEE_BPS,
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log("Saved deployment artifact:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
