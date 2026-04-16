const { ethers } = require("hardhat");

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "No signers found. Make sure your Hardhat network configuration includes private keys.",
    );
  }

  const deployer = signers[0];

  console.log("Deploying contract with address:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "ETH");
  const StKLDFactory = await ethers.getContractFactory("StKLD");
  const StKLDToken = await StKLDFactory.deploy(
    "0xb6fb7fd04eCF2723f8a5659134a145Bd7fE68748", //KLD vault Address
    "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505", //KLD Token Address
    {
      // from: deployer.address,
      // gasLimit: 50000000,
    },
  );

  await StKLDToken.waitForDeployment();

  console.log(
    "StKLD Token contract deployed to:",
    await StKLDToken.getAddress(),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
