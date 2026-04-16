const hre = require("hardhat");
const deploymentInfo = require("../deployment-abstractTestnet-1761557628558.json");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("Minting tokens with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  const USDT_ADDRESS = deploymentInfo.contracts.USDT;
  const USDE_ADDRESS = deploymentInfo.contracts.USDe;

  // 1 billion tokens
  // USDT has 6 decimals
  const usdtAmount = hre.ethers.parseUnits("1000000000", 6);
  // USDe has 18 decimals
  const usdeAmount = hre.ethers.parseUnits("1000000000", 18);

  console.log("\n=== Minting USDT ===");
  const USDT = await hre.ethers.getContractAt("USDT", USDT_ADDRESS);
  
  // Mint USDT
  console.log("Minting 1,000,000,000 USDT to deployer...");
  const tx1 = await USDT.mint(deployer.address, usdtAmount);
  await tx1.wait();
  console.log("USDT minted successfully!");
  console.log("Transaction:", tx1.hash);

  // Check balance
  const usdtBalance = await USDT.balanceOf(deployer.address);
  console.log("USDT Balance:", hre.ethers.formatUnits(usdtBalance, 6), "USDT");

  console.log("\n=== Minting USDe ===");
  const USDe = await hre.ethers.getContractAt("USDe", USDE_ADDRESS);
  
  // Mint USDe
  console.log("Minting 1,000,000,000 USDe to deployer...");
  const tx2 = await USDe.mint(deployer.address, usdeAmount);
  await tx2.wait();
  console.log("USDe minted successfully!");
  console.log("Transaction:", tx2.hash);

  // Check balance
  const usdeBalance = await USDe.balanceOf(deployer.address);
  console.log("USDe Balance:", hre.ethers.formatUnits(usdeBalance, 18), "USDe");

  console.log("\n=== Summary ===");
  console.log("USDT total supply:", hre.ethers.formatUnits(await USDT.totalSupply(), 6), "USDT");
  console.log("USDe total supply:", hre.ethers.formatUnits(await USDe.totalSupply(), 18), "USDe");
  console.log("\nAll tokens minted successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

