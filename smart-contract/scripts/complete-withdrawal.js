require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { ethers } = require('ethers');

// Contract addresses  
const KAFUSD_CONTRACT = '0x601191730174c2651E76dC69325681a5A5D5B9a6';
const KFUSD_ADDRESS = '0x913f3354942366809A05e89D288cCE60d87d7348'; // Withdraw as kfUSD

// ABIs
const kafUSDAbi = [
  'function completeWithdrawal(address asset) external',
  'function withdrawalAmount(address user) view returns (uint256)',
  'function withdrawalRequestTime(address user) view returns (uint256)',
  'function cooldownPeriod() view returns (uint256)'
];

async function completeWithdrawal() {
  try {
    const provider = new ethers.JsonRpcProvider('https://api.testnet.abs.xyz', {
      chainId: 11124,
      name: 'abstract-testnet'
    });

    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const kafUSDContract = new ethers.Contract(KAFUSD_CONTRACT, kafUSDAbi, wallet);

    console.log('\n=== Completing Withdrawal ===');
    console.log(`Wallet: ${wallet.address}\n`);

    // Check withdrawal status
    const [withdrawalAmount, withdrawalTime, cooldown] = await Promise.all([
      kafUSDContract.withdrawalAmount(wallet.address),
      kafUSDContract.withdrawalRequestTime(wallet.address),
      kafUSDContract.cooldownPeriod()
    ]);

    console.log(`Withdrawal Amount: ${ethers.formatUnits(withdrawalAmount, 18)} kafUSD`);
    console.log(`Requested At: ${new Date(Number(withdrawalTime) * 1000).toISOString()}`);
    console.log(`Cooldown: ${Number(cooldown) / 86400} days\n`);

    if (Number(withdrawalAmount) === 0) {
      console.log('✅ No active withdrawal to complete');
      return;
    }

    const unlockTime = Number(withdrawalTime) + Number(cooldown);
    const now = Math.floor(Date.now() / 1000);
    
    if (now < unlockTime) {
      const timeLeft = unlockTime - now;
      const days = Math.floor(timeLeft / 86400);
      const hours = Math.floor((timeLeft % 86400) / 3600);
      console.log(`⏳ Cooldown not complete yet. Time remaining: ${days}d ${hours}h`);
      return;
    }

    console.log('📝 Completing withdrawal to kfUSD...');
    const tx = await kafUSDContract.completeWithdrawal(KFUSD_ADDRESS);
    console.log(`⏳ Transaction sent: ${tx.hash}`);
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log('✅ Withdrawal completed successfully!\n');
      
      // Verify
      const newWithdrawalAmount = await kafUSDContract.withdrawalAmount(wallet.address);
      console.log(`New withdrawal amount: ${ethers.formatUnits(newWithdrawalAmount, 18)} kafUSD`);
    } else {
      console.log('❌ Transaction failed');
    }

  } catch (error) {
    console.error('\nError:', error);
  }
}

completeWithdrawal();
