const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const KLD_ADDRESS = "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505";
  const MASTER_CHEF = "0x6E5dA192512E58eb13dEF6815f4E46Ac58172eFE";
  const AMOUNT_TO_FUND = ethers.parseEther("10000000"); // 10M KLD

  console.log("Funding MasterChef with 10,000,000 KLD...");
  console.log("From:", deployer.address);
  console.log("To:", MASTER_CHEF);

  const abi = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)"
  ];
  const kld = new ethers.Contract(KLD_ADDRESS, abi, deployer);

  const tx = await kld.transfer(MASTER_CHEF, AMOUNT_TO_FUND);
  console.log("Tx hash:", tx.hash);
  await tx.wait();

  // Verify
  const bal = await kld.balanceOf(MASTER_CHEF);
  console.log("New MasterChef Balance:", ethers.formatEther(bal));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
