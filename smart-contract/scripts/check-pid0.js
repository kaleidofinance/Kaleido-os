const { ethers } = require("ethers");

async function main() {
  const RPC_URL = "https://api.testnet.abs.xyz";
  const MASTER_CHEF = "0x6E5dA192512E58eb13dEF6815f4E46Ac58172eFE";
  const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 11124, name: "abstract-testnet" }, { staticNetwork: true });

  const mcAbi = ["function poolInfo(uint256) view returns (address lpToken, uint256 allocPoint, uint256 lastRewardBlock, uint256 accKldPerShare)"];
  const mc = new ethers.Contract(MASTER_CHEF, mcAbi, provider);

  try {
    const info = await mc.poolInfo(0);
    console.log("PID 0 LP Token:", info.lpToken);
    console.log("Alloc Point:", info.allocPoint.toString());
  } catch (e) {
    console.error("Failed:", e.message);
  }
}

main();
