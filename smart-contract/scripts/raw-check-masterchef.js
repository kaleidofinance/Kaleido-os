const { ethers } = require("ethers");

async function main() {
  const RPC_URL = "https://api.testnet.abs.xyz";
  const KLD_ADDRESS = "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505";
  const MASTER_CHEF = "0x6E5dA192512E58eb13dEF6815f4E46Ac58172eFE";
  const POOL_ADDRESS = "0xa69dF8A83e440Aca138374dC32FA07d0d0825B3d"; // USDC-WETH pair from previous research

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  const tokenAbi = ["function balanceOf(address owner) view returns (uint256)"];
  const mcAbi = [
    "function poolLength() view returns (uint256)",
    "function poolInfo(uint256) view returns (address lpToken, uint256 allocPoint, uint256 lastRewardBlock, uint256 accKldPerShare)",
    "function totalAllocPoint() view returns (uint256)",
    "function kldPerBlock() view returns (uint256)"
  ];

  const kld = new ethers.Contract(KLD_ADDRESS, tokenAbi, provider);
  const mc = new ethers.Contract(MASTER_CHEF, mcAbi, provider);

  console.log("--- Checking MasterChef State ---");
  try {
    const mcBalance = await kld.balanceOf(MASTER_CHEF);
    console.log("MasterChef KLD Balance:", ethers.formatEther(mcBalance), "KLD");

    const poolLength = await mc.poolLength();
    console.log("Number of Pools:", poolLength.toString());

    const totalAlloc = await mc.totalAllocPoint();
    console.log("Total Alloc Point:", totalAlloc.toString());

    const kldPerBlock = await mc.kldPerBlock();
    console.log("KLD Per Block:", ethers.formatEther(kldPerBlock));

    for (let i = 0; i < Number(poolLength); i++) {
        const info = await mc.poolInfo(i);
        console.log(`Pool ${i}: LP=${info.lpToken}, Alloc=${info.allocPoint.toString()}`);
    }
  } catch (e) {
    console.error("Failed to query state:", e.message);
  }
}

main();
