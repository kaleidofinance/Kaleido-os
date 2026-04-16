const { ethers } = require("hardhat");

async function main() {
  const rpcUrl = "https://api.testnet.abs.xyz"; // Abstract Testnet
  const privateKey = "9e5345ca0415a07573d5b63737e0126382daceb88286d6947055b3d49270c139"; 
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("Debug User Address:", wallet.address);

  const KLD_ADDRESS = "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505";
  const ROUTER_ADDRESS = "0x2D164A49791e0b5B51F523d785C13F77c85A98fe";
  // We can use the wallet itself as a dummy "spender" to test transferFrom if we approve ourselves
  // Or we can just approve the wallet to spend its own tokens.

  const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) external returns (bool)"
  ];

  const kld = new ethers.Contract(KLD_ADDRESS, ERC20_ABI, wallet);

  // 1. Test Standard Transfer
  console.log("\n--- Testing Standard Transfer ---");
  const amount = ethers.parseUnits("1", 18);
  try {
      // Send to self
      const tx = await kld.transfer(wallet.address, amount);
      console.log("Transfer tx sent:", tx.hash);
      await tx.wait();
      console.log("✅ Transfer (to self) working!");
  } catch (e) {
      console.error("❌ Transfer Failed:", e.message);
  }

  // 2. Test TransferFrom
  console.log("\n--- Testing TransferFrom ---");
  // We need to approve 'wallet' to spend 'wallet' tokens to test transferFrom directly
  try {
      const approveTx = await kld.approve(wallet.address, amount);
      await approveTx.wait();
      console.log("Approved self for transferFrom.");

      const txFrom = await kld.transferFrom(wallet.address, wallet.address, amount);
      console.log("TransferFrom tx sent:", txFrom.hash);
      await txFrom.wait();
      console.log("✅ TransferFrom working!");
  } catch (e) {
      console.error("❌ TransferFrom Failed!");
      if (e.data) console.error("Revert Data:", e.data);
      else console.error(e.message);
  }

  // 3. Test TransferFrom via Router (Simulation)
  // We can't easily simulate Router calling transferFrom without using the Router
  // But we proved that failed in previous script.
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
