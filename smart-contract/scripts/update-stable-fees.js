const { ethers } = require("ethers");
require("dotenv").config({ path: "../.env" });

async function main() {
  const RPC_URL = "https://api.testnet.abs.xyz";
  const KFUSD_ADDRESS = "0x913f3354942366809A05e89D288cCE60d87d7348";
  
  // Use the private key from the environment
  const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.NEXT_PUBLIC_PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("No private key found in .env");
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL, {
    chainId: 11124,
    name: "abstract-testnet"
  }, { staticNetwork: true });
  
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  
  const abi = [
    "function setFees(uint256 _mintFee, uint256 _redeemFee) external",
    "function mintFee() view returns (uint256)",
    "function redeemFee() view returns (uint256)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function hasRole(bytes32 role, address account) view returns (bool)"
  ];
  
  const kfusd = new ethers.Contract(KFUSD_ADDRESS, abi, wallet);
  
  console.log("Using kfUSD at:", KFUSD_ADDRESS);
  console.log("Sender Address:", wallet.address);

  try {
    const adminRole = await kfusd.DEFAULT_ADMIN_ROLE();
    const isAdmin = await kfusd.hasRole(adminRole, wallet.address);
    
    if (!isAdmin) {
      console.error(`Error: Wallet ${wallet.address} is NOT an admin on kfUSD.`);
      return;
    }

    const currentMint = await kfusd.mintFee();
    const currentRedeem = await kfusd.redeemFee();
    console.log(`Current Fees: Mint ${Number(currentMint)/100}%, Redeem ${Number(currentRedeem)/100}%`);

    const newFee = 10; // 10 bps = 0.1%
    console.log(`Updating fees to: ${newFee/100}% each (20 bps round-trip)...`);

    const tx = await kfusd.setFees(newFee, newFee);
    console.log("Transaction sent! Hash:", tx.hash);
    
    await tx.wait();
    console.log("Transaction confirmed!");
    
    const finalMint = await kfusd.mintFee();
    const finalRedeem = await kfusd.redeemFee();
    console.log(`Final Fees: Mint ${Number(finalMint)/100}%, Redeem ${Number(finalRedeem)/100}%`);
  } catch (e) {
    console.error("Operation failed:", e.message);
  }
}

main();
