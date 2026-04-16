// Quick script to check how many pairs exist in the KaleidoSwap Factory
// Run this with: node check-pairs.js

const { ethers } = require('ethers');
require('dotenv').config();

const FACTORY_ADDRESS = "0x9f56B464Ac457Fa7f6cbe62F0c0523C290b52477";
const FACTORY_ABI = [
  "function allPairsLength() external view returns (uint)",
  "function allPairs(uint) external view returns (address)",
];

async function checkPairs() {
  const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  
  const pairsLength = await factory.allPairsLength();
  console.log(`Total pairs in KaleidoSwap Factory: ${pairsLength}`);
  
  if (pairsLength > 0) {
    console.log('\nPair addresses:');
    for (let i = 0; i < pairsLength; i++) {
      const pairAddress = await factory.allPairs(i);
      console.log(`  ${i + 1}. ${pairAddress}`);
    }
  } else {
    console.log('\nNo pairs created yet. You need to add liquidity to create the first pair!');
  }
}

checkPairs().catch(console.error);
