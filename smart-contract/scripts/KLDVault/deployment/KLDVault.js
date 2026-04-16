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
  const KLDValutFactory = await ethers.getContractFactory("KLDVault");
  const kldvault = await KLDValutFactory.deploy({
    // from: deployer.address,
    // gasLimit: 50000000,
  });

  await kldvault.waitForDeployment();

  console.log("KLDVault  contract deployed to:", await kldvault.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
