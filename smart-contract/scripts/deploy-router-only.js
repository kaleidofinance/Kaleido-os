/**
 * Deploy only a replacement KaleidoSwap V3 SwapRouter.
 *
 * This is intentionally separate from deploy-v3.js: replacing the router must
 * not create a second factory, position manager, quoter, or pool universe.
 *
 * Required:
 *   EXISTING_FACTORY=0x... WRAPPED_NATIVE=0x... \
 *   npx hardhat run scripts/deploy-router-only.js --network arcMainnet
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

const ARC_CHAIN_ID = 5042n;
const ARC_FACTORY = "0xbB74f2319494461B2591F8fbF126654Dd4c2a649";
const ARC_WRAPPED_NATIVE = "0x8c6c0A4C5500c2bC196383B4D85feb7f08a5C75b";

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== ARC_CHAIN_ID)
    throw new Error(`Refusing deployment on chain ${network.chainId}; expected Arc Mainnet ${ARC_CHAIN_ID}`);

  const factory = process.env.EXISTING_FACTORY;
  const wrappedNative = process.env.WRAPPED_NATIVE;
  if (!factory || !wrappedNative || !ethers.isAddress(factory) || !ethers.isAddress(wrappedNative))
    throw new Error("EXISTING_FACTORY and WRAPPED_NATIVE must be valid addresses");
  if (factory.toLowerCase() !== ARC_FACTORY.toLowerCase())
    throw new Error(`Refusing unexpected factory ${factory}`);
  if (wrappedNative.toLowerCase() !== ARC_WRAPPED_NATIVE.toLowerCase())
    throw new Error(`Refusing unexpected wrapped-native ${wrappedNative}`);
  if ((await ethers.provider.getCode(factory)) === "0x") throw new Error("Factory has no code");
  if ((await ethers.provider.getCode(wrappedNative)) === "0x") throw new Error("Wrapped native has no code");

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deploying from ${deployer.address} with ${ethers.formatEther(balance)} native balance`);

  const Router = await ethers.getContractFactory("SwapRouter");
  const router = await Router.deploy(factory, wrappedNative);
  await router.waitForDeployment();
  const address = await router.getAddress();
  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error("Router deployment returned no code");

  const out = {
    network: "arcMainnet",
    chainId: Number(network.chainId),
    timestamp: new Date().toISOString(),
    contracts: { router: address, factory, weth: wrappedNative },
  };
  const file = `deployment-router-arcMainnet-${Date.now()}.json`;
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, file }, null, 2));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("Router-only deployment failed:", error);
  process.exit(1);
});
