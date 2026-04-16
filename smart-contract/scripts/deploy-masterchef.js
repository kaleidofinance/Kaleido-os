const hre = require("hardhat");
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Configuration
  // KLD Token Address on Abstract Testnet (Fetched from contracts/Faucet.sol: 0x0c61dbCF1e8DdFF0E237a256257260fDF6934505)
  // Ensure this is correct!
  const KLD_ADDRESS = "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505";
  
  // Rewards per block (e.g. 0.05 KLD per block? Or 10?)
  // Let's go with 1 KLD per block for testing to be safe on faucet limits.
  const KLD_PER_BLOCK = ethers.parseEther("1");
  
  // Start Block (Use current block or slightly after)
  const currentBlock = await ethers.provider.getBlockNumber();
  const START_BLOCK = currentBlock + 10; // Start in ~10 blocks

  console.log("Configuration:");
  console.log("KLD Address:", KLD_ADDRESS);
  console.log("Rewards Per Block:", ethers.formatEther(KLD_PER_BLOCK));
  console.log("Start Block:", START_BLOCK);

  // Deploy MasterChef
  const MasterChef = await ethers.getContractFactory("KaleidoMasterChef");
  const masterChef = await MasterChef.deploy(
    KLD_ADDRESS,
    KLD_PER_BLOCK,
    START_BLOCK
  );
  
  await masterChef.waitForDeployment();
  const address = await masterChef.getAddress();

  console.log("KaleidoMasterChef deployed to:", address);

  // Verification instruction
  console.log(`Verify with: npx hardhat verify --network abstractTestnet ${address} ${KLD_ADDRESS} ${KLD_PER_BLOCK} ${START_BLOCK}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
