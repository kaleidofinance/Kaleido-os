const { ethers } = require("hardhat");

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "No signers found. Make sure your Hardhat network configuration includes private keys.",
    );
  }

  const deployer = signers[0];
  const priceFeedContractAddress = "0x47F2A9BDAd52d65b66287253cf5ca0D2b763b486";

  console.log("Deploying contract with address:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "ETH");
  const pythOracleContractFactory =
    await ethers.getContractFactory("PythPriceOracle");
  const PythPriceOracle = await pythOracleContractFactory.deploy(
    priceFeedContractAddress,
  );

  await PythPriceOracle.waitForDeployment();

  console.log(
    "PythPriceOracle  contract deployed to:",
    await PythPriceOracle.getAddress(),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
