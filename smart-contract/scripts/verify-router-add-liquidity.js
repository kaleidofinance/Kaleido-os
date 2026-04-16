const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const routerAddress = "0x3032eE3C14caed0E58e91A92CaBffba7AC89A0e9"; // New Router

  console.log("Verifying addLiquidityETH with Mock Token...");
  
  // 1. Deploy Mock Token
  const MockToken = await hre.ethers.getContractFactory("contracts/dex/test/MockToken.sol:MockToken");
  const initialSupply = hre.ethers.parseEther("1000000");
  const mockToken = await MockToken.deploy(initialSupply);
  await mockToken.waitForDeployment();
  const mockAddress = await mockToken.getAddress();
  console.log("Mock Token deployed to:", mockAddress);

  // 2. Approve Router
  console.log("Approving Router...");
  const approveTx = await mockToken.approve(routerAddress, initialSupply);
  await approveTx.wait();
  console.log("Approved.");

  // 3. Add Liquidity
  console.log("Adding Liquidity (ETH + Mock)...");
  const Router = await hre.ethers.getContractFactory("KaleidoSwapRouter");
  const router = Router.attach(routerAddress);

  const amountTokenDesired = hre.ethers.parseEther("100");
  const amountETHDesired = hre.ethers.parseEther("0.1");
  const deadline = Math.floor(Date.now() / 1000) + 1200;

  try {
     const tx = await router.addLiquidityETH(
        mockAddress,
        amountTokenDesired,
        0, // amountTokenMin
        0, // amountETHMin
        deployer.address,
        deadline,
        false, // stable (volatile)
        { value: amountETHDesired }
     );
     console.log("addLiquidityETH Transaction sent:", tx.hash);
     await tx.wait();
     console.log("SUCCESS: Liquidity Added!");
  } catch (error) {
     console.error("FAILURE: addLiquidityETH reverted!");
     if (error.data) console.error("Error Data:", error.data);
     else console.error(error);
  }
}

