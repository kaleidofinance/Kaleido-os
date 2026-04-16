const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  const RPC_URL = "https://api.testnet.abs.xyz"; 
  const FACTORY_ADDRESS = "0x0960d0CFE3AaB7Bb7d0718d41A9d949Ab37F4063";
  const YIELD_TREASURY = "0x9977ac5FDdb3B3B8bB22d438b3177F8EA8d4A809";
  
  // Use the private key from the environment
  const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.NEXT_PUBLIC_PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("No private key found in .env");
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  
  const abi = [
    "function setFeeTo(address _feeTo) external",
    "function feeTo() external view returns (address)",
    "function feeToSetter() external view returns (address)"
  ];
  
  const factory = new ethers.Contract(FACTORY_ADDRESS, abi, wallet);
  
  console.log("Using Factory at:", FACTORY_ADDRESS);
  console.log("Setting feeTo to:", YIELD_TREASURY);
  console.log("Sender Address:", wallet.address);

  try {
    const currentSetter = await factory.feeToSetter();
    if (currentSetter.toLowerCase() !== wallet.address.toLowerCase()) {
      console.error(`Error: Wallet ${wallet.address} is NOT the feeToSetter (${currentSetter}).`);
      return;
    }

    const tx = await factory.setFeeTo(YIELD_TREASURY);
    console.log("Transaction sent! Hash:", tx.hash);
    
    await tx.wait();
    console.log("Transaction confirmed!");
    
    const newFeeTo = await factory.feeTo();
    console.log("Final feeTo address:", newFeeTo);
  } catch (e) {
    console.error("Operation failed:", e.message);
  }
}

main();
