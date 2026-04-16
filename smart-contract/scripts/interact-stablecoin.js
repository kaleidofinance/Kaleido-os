const hre = require("ethers");

/**
 * Utility script to interact with the stablecoin contracts
 * Usage examples for common operations
 */

// Update these addresses after deployment
const CONTRACTS = {
  kfUSD: "YOUR_KFUSD_ADDRESS",
  kafUSD: "YOUR_KAFUSD_ADDRESS",
  USDC: "YOUR_USDC_ADDRESS",
  USDT: "YOUR_USDT_ADDRESS",
  USDe: "YOUR_USDE_ADDRESS"
};

async function mintKfUSD(kfusd, collateralToken, collateralAmount, account) {
  console.log("\n=== Minting kfUSD ===");
  
  // Approve kfUSD contract to spend collateral
  const collateral = await hre.ethers.getContractAt("IERC20", collateralToken);
  await collateral.approve(await kfusd.getAddress(), collateralAmount);
  console.log(`Approved ${collateralAmount} collateral tokens`);
  
  // Amount of kfUSD to mint (1:1 ratio, minus fees)
  const kfusdAmount = collateralAmount; // Adjust based on decimals
  
  // Mint kfUSD (requires MINTER_ROLE)
  // This should be called by an account with MINTER_ROLE
  const tx = await kfusd.mint(account.address, kfusdAmount, collateralToken, collateralAmount);
  await tx.wait();
  
  console.log(`Minted ${kfusdAmount} kfUSD to ${account.address}`);
}

async function redeemKfUSD(kfusd, kfusdAmount, outputToken, account) {
  console.log("\n=== Redeeming kfUSD ===");
  
  // Approve kfUSD contract to spend kfUSD
  await kfusd.approve(await kfusd.getAddress(), kfusdAmount);
  console.log(`Approved ${kfusdAmount} kfUSD`);
  
  // Redeem
  const tx = await kfusd.redeem(kfusdAmount, outputToken);
  await tx.wait();
  
  console.log(`Redeemed ${kfusdAmount} kfUSD for output token`);
}

async function lockAssetsForKafUSD(kafusd, asset, amount, account) {
  console.log("\n=== Locking Assets for kafUSD ===");
  
  // Approve kafUSD contract to spend asset
  const assetContract = await hre.ethers.getContractAt("IERC20", asset);
  await assetContract.approve(await kafusd.getAddress(), amount);
  console.log(`Approved ${amount} assets`);
  
  // Lock assets
  const tx = await kafusd.lockAssets(asset, amount);
  await tx.wait();
  
  console.log(`Locked ${amount} assets, received kafUSD`);
}

async function requestWithdrawal(kafusd, amount, account) {
  console.log("\n=== Requesting Withdrawal ===");
  
  const tx = await kafusd.requestWithdrawal(amount);
  await tx.wait();
  
  const unlockTime = await kafusd.withdrawalRequestTime(account.address);
  console.log(`Withdrawal requested. Can complete after: ${new Date(Number(unlockTime) * 1000)}`);
}

async function completeWithdrawal(kafusd, outputAsset, account) {
  console.log("\n=== Completing Withdrawal ===");
  
  const tx = await kafusd.completeWithdrawal(outputAsset);
  await tx.wait();
  
  console.log(`Withdrawal completed for ${outputAsset}`);
}

async function getBackingRatio(kfusd) {
  console.log("\n=== Getting Backing Ratio ===");
  
  const ratio = await kfusd.getBackingRatio();
  console.log(`Backing Ratio: ${ratio.toString()}`);
  console.log(`Interpretation: ${ratio.toString()} / 1e18 means ${Number(ratio) / 1e18}x over-collateralized`);
}

async function getTotalStats(kfusd, kafusd) {
  console.log("\n=== Contract Statistics ===");
  
  const kfusdTotalSupply = await kfusd.totalSupply();
  const kfusdTotalCollateral = await kfusd.getTotalCollateralValue();
  const backingRatio = await kfusd.getBackingRatio();
  
  console.log(`kfUSD Total Supply: ${kfusdTotalSupply.toString()}`);
  console.log(`Total Collateral Value: ${kfusdTotalCollateral.toString()}`);
  console.log(`Backing Ratio: ${backingRatio.toString()}`);
  
  const kafusdTotalSupply = await kafusd.totalSupply();
  const kafusdTotalLocked = await kafusd.totalLocked();
  
  console.log(`\nkafUSD Total Supply: ${kafusdTotalSupply.toString()}`);
  console.log(`Total Locked: ${kafusdTotalLocked.toString()}`);
}

async function main() {
  console.log("Stablecoin Interaction Script");
  console.log("Update contract addresses in the CONTRACTS object first!\n");
  
  const [account] = await hre.ethers.getSigners();
  console.log("Interacting from account:", account.address);
  
  // Get contract instances
  const kfusd = await hre.ethers.getContractAt("kfUSD", CONTRACTS.kfUSD);
  const kafusd = await hre.ethers.getContractAt("kafUSD", CONTRACTS.kafUSD);
  
  // Example interactions (uncomment to use)
  
  // 1. Get contract statistics
  // await getTotalStats(kfusd, kafusd);
  
  // 2. Mint kfUSD with collateral
  // await mintKfUSD(kfusd, CONTRACTS.USDC, "1000000000", account); // 1000 USDC (6 decimals)
  
  // 3. Redeem kfUSD
  // await redeemKfUSD(kfusd, "1000000000", CONTRACTS.USDT, account);
  
  // 4. Lock assets for kafUSD
  // await lockAssetsForKafUSD(kafusd, CONTRACTS.kfUSD, "1000000000000000000", account); // 1 kfUSD (18 decimals)
  
  // 5. Request withdrawal
  // await requestWithdrawal(kafusd, "1000000000000000000", account);
  
  // 6. Complete withdrawal (after cooldown)
  // await completeWithdrawal(kafusd, CONTRACTS.kfUSD, account);
  
  // 7. Get backing ratio
  // await getBackingRatio(kfusd);
  
  console.log("\nScript completed. Uncomment functions above to interact with contracts.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

