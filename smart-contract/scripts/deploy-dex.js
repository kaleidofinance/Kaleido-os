const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying KaleidoSwap with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // 1. Deploy Factory
  console.log("\nDeploying KaleidoSwapFactory...");
  const feeToSetter = deployer.address;
  const Factory = await hre.ethers.getContractFactory("KaleidoSwapFactory");
  const pairArtifact = await hre.artifacts.readArtifact("KaleidoSwapPair");
  const factory = await Factory.deploy(feeToSetter, {
    customData: {
      factoryDeps: [pairArtifact.bytecode]
    }
  });
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("KaleidoSwapFactory deployed to:", factoryAddress);

  // 2. Reuse Existing WETH9
  console.log("\nUsing existing WETH9...");
  // const WETH = await hre.ethers.getContractFactory("WETH9");
  // const weth = await WETH.deploy();
  // await weth.waitForDeployment();
  // const wethAddress = await weth.getAddress();
  const wethAddress = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // Old WETH
  console.log("WETH9 address:", wethAddress);

  // 3. Deploy Router
  console.log("\nDeploying KaleidoSwapRouter...");
  const Router = await hre.ethers.getContractFactory("KaleidoSwapRouter");
  const router = await Router.deploy(factoryAddress, wethAddress);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log("KaleidoSwapRouter deployed to:", routerAddress);

  // Output addresses to a file
  const deploymentInfo = {
    network: hre.network.name,
    deployer: deployer.address,
    contracts: {
      KaleidoSwapFactory: factoryAddress,
      WETH9: wethAddress,
      KaleidoSwapRouter: routerAddress
    },
    timestamp: new Date().toISOString()
  };

  const filename = `deployment-dex-${hre.network.name}.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
  console.log("\nDeployment info saved to:", filename);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
