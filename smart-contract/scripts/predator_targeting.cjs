const { ethers } = require("hardhat");

async function main() {
  const ROUTER_ADDR = "0x3032eE3C14caed0E58e91A92CaBffba7AC89A0e9";
  const ROUTER_ABI = [
    "function voter() external view returns (address)",
    "function factory() external view returns (address)",
    "function defaultFactory() external view returns (address)"
  ];
  const VOTER_ABI = [
    "function pools(uint256) external view returns (address)",
    "function gauges(address) external view returns (address)",
    "function length() external view returns (uint256)"
  ];

  const router = new ethers.Contract(ROUTER_ADDR, ROUTER_ABI, ethers.provider);
  
  console.log("--- 🐆 PREDATOR TARGETING ENGINE ---");
  const voterAddr = await router.voter();
  console.log(`Voter Identified: ${voterAddr}`);
  
  const voter = new ethers.Contract(voterAddr, VOTER_ABI, ethers.provider);
  const poolCount = await voter.length();
  console.log(`Active Aborean Pools: ${poolCount}`);

  for(let i=0; i<Math.min(poolCount, 5); i++) {
    const pool = await voter.pools(i);
    const gauge = await voter.gauges(pool);
    console.log(`Target Pool [${i}]: ${pool} | Gauge: ${gauge}`);
  }
}

main().catch(console.error);
