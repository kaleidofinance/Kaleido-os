require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { ethers } = require('ethers');

// Contract addresses  
const KAFUSD_CONTRACT = '0x601191730174c2651E76dC69325681a5A5D5B9a6';

const ASSETS = {
  'kfUSD': '0x913f3354942366809A05e89D288cCE60d87d7348',
  'USDC': '0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3',
  'USDT': '0x717A36E56b33585Bd00260422FfCc3270af34D3E',
  'USDe': '0x2F7744E8fcc75F8F26Ea455968556591091cb46F'
};

// ABIs
const kafUSDAbi = [
  'function getUserAssetBalance(address user, address asset) view returns (uint256)',
  'function assetLockBalances(address user, address asset) view returns (uint256)',
  'function withdrawalAmount(address user) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)'
];

const erc20Abi = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

async function checkLockedAssets() {
  try {
    const provider = new ethers.JsonRpcProvider('https://api.testnet.abs.xyz', {
      chainId: 11124,
      name: 'abstract-testnet'
    });

    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const kafUSDContract = new ethers.Contract(KAFUSD_CONTRACT, kafUSDAbi, provider);

    console.log('\n=== Checking Locked Assets ===');
    console.log(`User: ${wallet.address}\n`);

    // Check kafUSD balance
    const kafUSDBalance = await kafUSDContract.balanceOf(wallet.address);
    console.log(`kafUSD Balance: ${ethers.formatUnits(kafUSDBalance, 18)}\n`);

    // Check withdrawal amount
    const withdrawalAmount = await kafUSDContract.withdrawalAmount(wallet.address);
    console.log(`Pending Withdrawal: ${ethers.formatUnits(withdrawalAmount, 18)} kafUSD\n`);

    console.log('--- Locked Asset Balances ---');
    let totalLocked = 0;
    let lockedAssets = [];

    for (const [name, address] of Object.entries(ASSETS)) {
      try {
        const lockedBalance = await kafUSDContract.getUserAssetBalance(wallet.address, address);
        
        if (Number(lockedBalance) > 0) {
          const assetContract = new ethers.Contract(address, erc20Abi, provider);
          const decimals = await assetContract.decimals();
          const formattedBalance = ethers.formatUnits(lockedBalance, decimals);
          
          console.log(`✅ ${name}: ${formattedBalance} (locked)`);
          totalLocked += parseFloat(formattedBalance);
          lockedAssets.push({ name, address, balance: formattedBalance });
        } else {
          console.log(`   ${name}: 0.0`);
        }
      } catch (error) {
        console.log(`❌ ${name}: Error - ${error.message}`);
      }
    }

    console.log(`\nTotal Locked Value: ~$${totalLocked.toFixed(2)}\n`);

    if (lockedAssets.length > 0 && Number(withdrawalAmount) > 0) {
      console.log('=== Withdrawal Recommendation ===');
      console.log(`You should withdraw as: ${lockedAssets[0].name}`);
      console.log(`Asset Address: ${lockedAssets[0].address}`);
      console.log(`\nTo complete withdrawal, run:`);
      console.log(`completeWithdrawal("${lockedAssets[0].address}")\n`);
    }

  } catch (error) {
    console.error('\nError:', error);
  }
}

checkLockedAssets();
