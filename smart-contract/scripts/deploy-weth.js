/**
 * Deploy the wrapped-native (WETH9) a KaleidoSwap V3 deployment needs.
 *
 * The V3 periphery (SwapRouter, NonfungiblePositionManager, Quoter) takes the
 * wrapped native as a constructor immutable and refuses to deploy without one
 * that holds code — see deploy-v3.js. On chains with a canonical wrapped native
 * (Sepolia's WETH, Arc TESTNET's third-party WUSDC) we pass that address. Arc
 * MAINNET has none — its native is USDC, Uniswap v4 there handles native without
 * wrapping, and no third-party WETH9 is deployed — so we deploy our own here and
 * feed its address to deploy-v3 as WRAPPED_NATIVE.
 *
 *   npm run deploy:weth -- --network arcMainnet
 *
 * Note: WETH9.sol reports name "Wrapped Ether"/"WETH". On Arc it wraps native
 * USDC, so that label is cosmetically off; it is the periphery's rarely-touched
 * convenience-wrap path (pools hold ERC20s directly), so it is acceptable for the
 * DEX-first launch. A "Wrapped USDC" variant is a trivial follow-up if wanted.
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying WETH9 (wrapped native) with:", deployer.address);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(bal), "(native)");
  if (bal === 0n) {
    throw new Error(
      "Deployer holds zero balance on " +
        hre.network.name +
        " — fund it before deploying.",
    );
  }

  const WETH9 = await ethers.getContractFactory("WETH9");
  const weth = await WETH9.deploy();
  await weth.waitForDeployment();
  const addr = await weth.getAddress();

  const { chainId } = await ethers.provider.getNetwork();
  console.log("\n✅ WETH9 deployed at:", addr);
  console.log("   Now set it as WRAPPED_NATIVE and run deploy:v3:");
  console.log("   WRAPPED_NATIVE=" + addr);

  const record = {
    network: hre.network.name,
    chainId: Number(chainId),
    weth: addr,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };
  const file = path.join(
    __dirname,
    "..",
    `deployment-weth-${hre.network.name}-${Date.now()}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  console.log("   Record written:", path.basename(file));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
