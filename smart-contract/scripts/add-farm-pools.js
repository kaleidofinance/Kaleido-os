const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Interacting with contracts with account:", deployer.address);

  // Addresses
  const MASTER_CHEF_ADDRESS = ethers.getAddress("0x6E5dA192512E58eb13dEF6815f4E46Ac58172eFE".toLowerCase());
  const FACTORY_ADDRESS = ethers.getAddress("0x0960d0CFE3AaB7Bb7d0718d41A9d949Ab37F4063".toLowerCase()); 
  const USDC_ADDRESS = ethers.getAddress("0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3".toLowerCase());
  const WETH_ADDRESS = ethers.getAddress("0x618B1561b189972482168fd31f5B5a3B5A10Ce33".toLowerCase());

  console.log("MasterChef:", MASTER_CHEF_ADDRESS);
  console.log("Factory:", FACTORY_ADDRESS);

  // Check Code
  const factoryCode = await ethers.provider.getCode(FACTORY_ADDRESS);
  if (factoryCode === "0x") {
    console.error("Factory contract has NO CODE. Aborting.");
    process.exit(1);
  } else {
    console.log("Factory code size:", factoryCode.length);
  }

  const mcCode = await ethers.provider.getCode(MASTER_CHEF_ADDRESS);
  if (mcCode === "0x") {
    console.error("MasterChef contract has NO CODE. Aborting.");
    process.exit(1);
  }

  // Get Contracts
  const MasterChef = await ethers.getContractFactory("KaleidoMasterChef");
  const masterChef = MasterChef.attach(MASTER_CHEF_ADDRESS);

  const Factory = await ethers.getContractFactory("KaleidoSwapFactory");
  const factory = Factory.attach(FACTORY_ADDRESS);

  // 1. Get/Create USDC-WETH Pair
  console.log("Finding USDC-WETH Pair...");
  let pairAddress;
  try {
     pairAddress = await factory.getPair(USDC_ADDRESS, WETH_ADDRESS);
  } catch (e) {
     console.log("getPair failed:", e.message);
     // Try ignoring or assuming it doesn't exist? 
     // If getPair failed with BAD_DATA despite code existing, it's weird.
  }
  
  if (!pairAddress || pairAddress === "0x0000000000000000000000000000000000000000") {
    console.log("Pair not found. Creating it...");
    // createPair takes (tokenA, tokenB, fee)
    // Fee 30 = 0.3%
    try {
        const tx = await factory.createPair(USDC_ADDRESS, WETH_ADDRESS, 30);
        await tx.wait();
        // Fetch again
        pairAddress = await factory.getPair(USDC_ADDRESS, WETH_ADDRESS);
        console.log("Created Pair at:", pairAddress);
    } catch (createError) {
        console.error("Failed to create pair:", createError);
        process.exit(1);
    }
  } else {
    console.log("Found Pair at:", pairAddress);
  }

  // 2. Add to MasterChef
  console.log("Adding pool to MasterChef...");
  
  // Check if pool already exists to avoid duplicate
  const poolLength = await masterChef.poolLength();
  console.log("Current Pool Length:", poolLength.toString());
  
  let poolExists = false;
  for (let i = 0; i < Number(poolLength); i++) {
    const poolInfo = await masterChef.poolInfo(i);
    // Use toLowerCase for comparison
    if (poolInfo.lpToken.toLowerCase() === pairAddress.toLowerCase()) {
      poolExists = true;
      console.log(`Pool for ${pairAddress} already exists at PID ${i}`);
      break;
    }
  }

  if (!poolExists) {
    const allocPoint = 100; // Weight of the pool
    const withUpdate = true;
    const tx = await masterChef.add(allocPoint, pairAddress, withUpdate);
    await tx.wait();
    console.log("Pool added successfully!");
  } else {
    console.log("Skipping add - pool exists.");
  }

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
