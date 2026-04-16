require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { ethers } = require('ethers');

// Contract addresses
const YIELD_TREASURY = '0x9977ac5FDdb3B3B8bB22d438b3177F8EA8d4A809';
const KAFUSD_CONTRACT = '0x601191730174c2651E76dC69325681a5A5D5B9a6';

// Your wallet address from the screenshot (with 2.4M kafUSD)
const USER_ADDRESS = process.env.USER_ADDRESS || '0xYourWalletAddress';

// ABIs
const yieldTreasuryAbi = [
  'function getSupportedYieldAssets() view returns (address[])',
  'function getYieldBalance(address asset) view returns (uint256)',
  'function calculateTotalUserYield(address user) view returns (address[] assets, uint256[] amounts)',
  'function yieldBalancePerAsset(address asset) view returns (uint256)'
];

const kafUSDAbi = [
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function withdrawalRequestTime(address user) view returns (uint256)',
  'function withdrawalAmount(address user) view returns (uint256)',
  'function cooldownPeriod() view returns (uint256)'
];

const erc20Abi = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

async function debugYieldIssue() {
  try {
    const provider = new ethers.JsonRpcProvider('https://api.testnet.abs.xyz', {
      chainId: 11124,
      name: 'abstract-testnet'
    });

    console.log('\n=== Debugging Yield Display Issues ===');
    console.log(`User Address: ${USER_ADDRESS}\n`);

    // 1. Check kafUSD balance and total supply
    const kafUSDContract = new ethers.Contract(KAFUSD_CONTRACT, kafUSDAbi, provider);
    const yieldTreasuryContract = new ethers.Contract(YIELD_TREASURY, yieldTreasuryAbi, provider);

    console.log('--- kafUSD Info ---');
    const [userKafUSDBalance, totalKafUSDSupply] = await Promise.all([
      kafUSDContract.balanceOf(USER_ADDRESS),
      kafUSDContract.totalSupply()
    ]);
    
    console.log(`User kafUSD Balance: ${ethers.formatUnits(userKafUSDBalance, 18)}`);
    console.log(`Total kafUSD Supply: ${ethers.formatUnits(totalKafUSDSupply, 18)}`);
    console.log(`User's Share: ${(Number(userKafUSDBalance) / Number(totalKafUSDSupply) * 100).toFixed(2)}%\n`);

    // 2. Check YieldTreasury balances
    console.log('--- YieldTreasury Balances ---');
    const supportedAssets = await yieldTreasuryContract.getSupportedYieldAssets();
    console.log(`Supported yield assets: ${supportedAssets.length}\n`);

    for (const asset of supportedAssets) {
      try {
        const yieldBalance = await yieldTreasuryContract.getYieldBalance(asset);
        const assetContract = new ethers.Contract(asset, erc20Abi, provider);
        const [symbol, decimals] = await Promise.all([
          assetContract.symbol(),
          assetContract.decimals()
        ]);
        
        const formattedBalance = ethers.formatUnits(yieldBalance, decimals);
        console.log(`  ${symbol} (${asset}):`);
        console.log(`    Total Yield Balance: ${formattedBalance}`);
        
        if (Number(yieldBalance) > 0) {
          const userShare = (Number(yieldBalance) * Number(userKafUSDBalance)) / Number(totalKafUSDSupply);
          console.log(`    Your Estimated Share: ${ethers.formatUnits(userShare, decimals)}`);
        }
        console.log('');
      } catch (error) {
        console.log(`  Error fetching info for ${asset}: ${error.message}\n`);
      }
    }

    // 3. Try calling calculateTotalUserYield directly
    console.log('--- Direct Yield Calculation ---');
    try {
      const [assets, amounts] = await yieldTreasuryContract.calculateTotalUserYield(USER_ADDRESS);
      
      if (assets.length === 0) {
        console.log('⚠️  No yield assets returned from calculateTotalUserYield');
      } else {
        console.log(`Found ${assets.length} yield asset(s):`);
        for (let i = 0; i < assets.length; i++) {
          const assetContract = new ethers.Contract(assets[i], erc20Abi, provider);
          const [symbol, decimals] = await Promise.all([
            assetContract.symbol(),
            assetContract.decimals()
          ]);
          console.log(`  ${symbol}: ${ethers.formatUnits(amounts[i], decimals)}`);
        }
      }
    } catch (error) {
      console.log(`❌ Error calling calculateTotalUserYield: ${error.message}`);
    }

    // 4. Check withdrawal info
    console.log('\n--- Withdrawal Info ---');
    try {
      const [withdrawalRequestTime, withdrawalAmount, cooldownPeriod] = await Promise.all([
        kafUSDContract.withdrawalRequestTime(USER_ADDRESS),
        kafUSDContract.withdrawalAmount(USER_ADDRESS),
        kafUSDContract.cooldownPeriod()
      ]);

      console.log(`Withdrawal Request Time: ${withdrawalRequestTime} (${new Date(Number(withdrawalRequestTime) * 1000).toISOString()})`);
      console.log(`Withdrawal Amount: ${ethers.formatUnits(withdrawalAmount, 18)} kafUSD`);
      console.log(`Cooldown Period: ${Number(cooldownPeriod) / 86400} days`);

      if (Number(withdrawalAmount) > 0) {
        const unlockTime = Number(withdrawalRequestTime) + Number(cooldownPeriod);
        const now = Math.floor(Date.now() / 1000);
        const timeLeft = unlockTime - now;
        
        if (timeLeft > 0) {
          const days = Math.floor(timeLeft / 86400);
          const hours = Math.floor((timeLeft % 86400) / 3600);
          const minutes = Math.floor((timeLeft % 3600) / 60);
          console.log(`⏳ Unlock Time Remaining: ${days}d ${hours}h ${minutes}m`);
        } else {
          console.log(`✅ Withdrawal ready to complete!`);
        }
      } else {
        console.log(`ℹ️  No active withdrawal request`);
      }
    } catch (error) {
      console.log(`❌ Error fetching withdrawal info: ${error.message}`);
    }

  } catch (error) {
    console.error('\nError:', error);
  }
}

console.log('\n⚠️  Please set USER_ADDRESS in your .env file to your wallet address');
console.log('Example: USER_ADDRESS=0x28b7b3dc96e5b2C6047D7Ad9b05Fd9E2FC7E8955\n');

debugYieldIssue();
