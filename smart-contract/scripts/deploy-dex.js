/**
 * KaleidoSwap V2 deployment — factory and router.
 *
 *   WRAPPED_NATIVE=0x... npx hardhat run scripts/deploy-dex.js --network baseTestnet
 *
 * Two defects made this script unrunnable on every EVM chain before 2026-08-20:
 *
 *  1. The wrapped-native address was the literal 0x618B1561…0Ce33, commented
 *     "Old WETH" — Abstract testnet's WETH, which holds no code anywhere else.
 *     The router would have deployed cleanly and reverted on every native-token
 *     path. It is now required input with a getCode check, matching deploy-v3.js.
 *
 *  2. The factory deploy passed `{ customData: { factoryDeps: [...] } }` on every
 *     network. customData is a zksync-ethers extension; plain ethers v6 rejects
 *     it as an unsupported override, so the very first transaction threw before
 *     it was sent. It is now gated on hre.network.config.zksync, the same way
 *     deploy.js gates its gas limits.
 *
 * Unlike V3, V2 needs no init-code-hash work: KaleidoSwapLibrary.pairFor resolves
 * pairs with IKaleidoSwapFactory(factory).getPair(token0, token1) rather than by
 * CREATE2 derivation, so there is no constant to keep in sync with the build.
 *
 * Writes deployment-dex-<network>.json, which scripts/gen-registry.mjs reads.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

/**
 * zkSync needs the pair's creation code declared up front as a factory
 * dependency, because CREATE2 there references a bytecode hash the node must
 * already know. On the EVM the pair's creation code is embedded in the factory's
 * own bytecode and no such declaration exists — passing one is an error, not a
 * no-op.
 */
const isZkSync = Boolean(hre.network.config.zksync);

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log("Deploying KaleidoSwap V2");
  console.log("  network:  ", hre.network.name, `(chainId ${chainId})`);
  console.log("  deployer: ", deployer.address);
  console.log(
    "  balance:  ",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
  );

  const wethAddress = process.env.WRAPPED_NATIVE;
  if (!wethAddress || !ethers.isAddress(wethAddress)) {
    throw new Error(
      "WRAPPED_NATIVE is required and must be a valid address.\n" +
        "It is the wrapped-native token on the target chain and cannot be\n" +
        "guessed from the native symbol — on Arc it wraps USDC, not ether.\n" +
        `Example: WRAPPED_NATIVE=0x... npx hardhat run scripts/deploy-dex.js --network ${hre.network.name}`,
    );
  }
  if ((await ethers.provider.getCode(wethAddress)) === "0x") {
    throw new Error(
      `WRAPPED_NATIVE ${wethAddress} holds no code on ${hre.network.name}.\n` +
        "This is almost always an address copied from another chain. The router\n" +
        "would deploy cleanly and then revert on every native-token path.",
    );
  }
  console.log("  wrapped native:", wethAddress);

  // 1. Factory. feeToSetter starts as the deployer and must be handed to the
  //    multisig alongside Diamond ownership — it controls the V2 protocol fee.
  console.log("\nDeploying KaleidoSwapFactory...");
  const feeToSetter = process.env.V2_FEE_TO_SETTER || deployer.address;
  if (!ethers.isAddress(feeToSetter)) {
    throw new Error(`V2_FEE_TO_SETTER is not a valid address: ${feeToSetter}`);
  }
  const Factory = await ethers.getContractFactory("KaleidoSwapFactory");
  const overrides = isZkSync
    ? {
        customData: {
          factoryDeps: [(await hre.artifacts.readArtifact("KaleidoSwapPair")).bytecode],
        },
      }
    : {};
  const factory = await Factory.deploy(feeToSetter, overrides);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("KaleidoSwapFactory deployed to:", factoryAddress);
  console.log("  feeToSetter:", feeToSetter);

  // 2. Router.
  console.log("\nDeploying KaleidoSwapRouter...");
  const Router = await ethers.getContractFactory("KaleidoSwapRouter");
  const router = await Router.deploy(factoryAddress, wethAddress);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log("KaleidoSwapRouter deployed to:", routerAddress);

  // 3. Protocol fee, off unless asked for. feeTo starts at the zero address and
  //    the pair's _mintFee is a no-op until it is set, so a plain deploy ships
  //    the fee off — as it should during the testnet phase, where feeToSetter is
  //    still the deployer rather than the multisig. V2_FEE_TO turns it on at
  //    deploy time for the chains that want it; the deployer is feeToSetter here,
  //    so it is authorised. For already-deployed chains, use set-dex-fees.js.
  let feeTo = ethers.ZeroAddress;
  if (process.env.V2_FEE_TO) {
    feeTo = process.env.V2_FEE_TO;
    if (!ethers.isAddress(feeTo)) {
      throw new Error(`V2_FEE_TO is not a valid address: ${feeTo}`);
    }
    console.log("\nSetting V2 protocol fee recipient (feeTo)...");
    await (await factory.setFeeTo(feeTo)).wait();
    console.log("  feeTo:", feeTo);
  }

  const deploymentInfo = {
    network: hre.network.name,
    chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      v2Factory: factoryAddress,
      v2Router: routerAddress,
      wrappedNative: wethAddress,
    },
    notes: {
      feeToSetter,
      feeTo,
      pairResolution: "factory.getPair — no init code hash to keep in sync",
    },
  };

  const filename = `deployment-dex-${hre.network.name}.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));

  console.log("\n============================================================");
  console.log("V2 DEPLOYMENT SUMMARY");
  console.log("============================================================");
  console.log("Factory:        ", factoryAddress);
  console.log("Router:         ", routerAddress);
  console.log("Wrapped native: ", wethAddress);
  console.log(
    "\nRun `npm run gen:registry` from the repo root to fold these into\n" +
      "src/constants/deployments.generated.ts. The app resolves addresses from\n" +
      "the registry, not from this file — until the generator runs, isDeployed()\n" +
      "for this chain reflects the previous deploy, not this one.",
  );
  console.log("Saved to:", filename);
  console.log("============================================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
