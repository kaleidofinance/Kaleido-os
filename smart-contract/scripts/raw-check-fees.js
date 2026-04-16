const { ethers } = require("ethers");

async function main() {
  const RPC_URL = "https://api.testnet.abs.xyz"; // Abstract Testnet RPC
  const FACTORY_ADDRESS = "0x0960d0CFE3AaB7Bb7d0718d41A9d949Ab37F4063";
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  const abi = [
    "function feeTo() external view returns (address)",
    "function feeToSetter() external view returns (address)"
  ];
  
  const factory = new ethers.Contract(FACTORY_ADDRESS, abi, provider);
  
  console.log("Querying Factory via direct RPC...");
  try {
    const feeTo = await factory.feeTo();
    const feeToSetter = await factory.feeToSetter();
    
    console.log("Current feeTo (Recipient):", feeTo);
    console.log("Current feeToSetter (Admin):", feeToSetter);
  } catch (e) {
    console.error("RPC call failed:", e.message);
  }
}

main();
