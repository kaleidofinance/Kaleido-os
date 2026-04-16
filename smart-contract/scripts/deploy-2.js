const { ethers } =  require("hardhat");

async function main() {
  const signers = await ethers.getSigners(); 
  if (signers.length === 0) {
    throw new Error("No signers found. Make sure your Hardhat network configuration includes private keys.");
  }

  const deployer = signers[0]; 

  console.log("Deploying contract with address:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "ETH");
  const KaleidoVaultFactory = await ethers.getContractFactory("PythPriceOracle");
  const kaleidoVault = await KaleidoVaultFactory.deploy("0x8739d5024B5143278E2b15Bd9e7C26f6CEc658F1",{
    // from: deployer.address,
    // gasLimit: 50000000, 
  });
  
  await kaleidoVault.waitForDeployment();
  
  console.log("KaleidoVault contract deployed to:", await kaleidoVault.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
