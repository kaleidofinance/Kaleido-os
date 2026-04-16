const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const KLD_ADDRESS = "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505"; // From summary
  const MASTER_CHEF = "0x6E5dA192512E58eb13dEF6815f4E46Ac58172eFE";

  console.log("Checking balances...");
  console.log("Deployer:", deployer.address);
  console.log("MasterChef:", MASTER_CHEF);

  // Use a simple ABI instead of getContractAt to avoid artifact conflict
  const abi = [
    "function balanceOf(address owner) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)"
  ];
  const kld = new ethers.Contract(KLD_ADDRESS, abi, deployer);
  
  const deployerBal = await kld.balanceOf(deployer.address);
  const mcBal = await kld.balanceOf(MASTER_CHEF);

  console.log("Deployer KLD Balance:", ethers.formatEther(deployerBal));
  console.log("MasterChef KLD Balance:", ethers.formatEther(mcBal));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
