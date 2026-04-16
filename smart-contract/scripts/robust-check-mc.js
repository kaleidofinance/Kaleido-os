const { ethers } = require("ethers");

async function main() {
  const RPC_URL = "https://api.testnet.abs.xyz";
  const KLD_ADDRESS = "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505";
  const MASTER_CHEF = "0x6E5dA192512E58eb13dEF6815f4E46Ac58172eFE";

  console.log("Connecting to RPC:", RPC_URL);
  
  // Use a shorter timeout and more specific network detection
  const provider = new ethers.JsonRpcProvider(RPC_URL, {
    chainId: 11124,
    name: "abstract-testnet"
  }, { staticNetwork: true });

  const tokenAbi = ["function balanceOf(address owner) view returns (uint256)"];
  const mcAbi = [
    "function poolLength() view returns (uint256)",
    "function kldPerBlock() view returns (uint256)"
  ];

  try {
    const kld = new ethers.Contract(KLD_ADDRESS, tokenAbi, provider);
    const mc = new ethers.Contract(MASTER_CHEF, mcAbi, provider);

    console.log("Fetching balances and state...");
    
    // Use Promise.race for a manual timeout if needed, but ethers should handle it
    const mcBalance = await kld.balanceOf(MASTER_CHEF);
    console.log("MasterChef KLD Balance:", ethers.formatEther(mcBalance), "KLD");

    const poolLength = await mc.poolLength();
    console.log("Number of Pools:", poolLength.toString());

    const kldPerBlock = await mc.kldPerBlock();
    console.log("KLD Per Block:", ethers.formatEther(kldPerBlock));

  } catch (e) {
    console.error("Query failed!");
    console.error("Error Message:", e.message);
    if (e.code) console.error("Error Code:", e.code);
  }
}

main();
