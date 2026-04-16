require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { ethers } = require('ethers');

const KAFUSD_CONTRACT = '0x601191730174c2651E76dC69325681a5A5D5B9a6';

const kafUSDAbi = [
  'function lockTimestamps(address user) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)'
];

async function checkLockTime() {
  try {
    const provider = new ethers.JsonRpcProvider('https://api.testnet.abs.xyz', {
      chainId: 11124,
      name: 'abstract-testnet'
    });

    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const kafUSDContract = new ethers.Contract(KAFUSD_CONTRACT, kafUSDAbi, provider);

    console.log('\n=== Lock Time Information ===');
    console.log(`User: ${wallet.address}\n`);

    const [lockTimestamp, kafUSDBalance] = await Promise.all([
      kafUSDContract.lockTimestamps(wallet.address),
      kafUSDContract.balanceOf(wallet.address)
    ]);

    console.log(`kafUSD Balance: ${ethers.formatUnits(kafUSDBalance, 18)}`);
    
    if (Number(lockTimestamp) === 0) {
      console.log('\nNo lock timestamp recorded (or never locked)');
    } else {
      const lockDate = new Date(Number(lockTimestamp) * 1000);
      const now = new Date();
      const timeSinceLock = now - lockDate;
      
      const days = Math.floor(timeSinceLock / (1000 * 60 * 60 * 24));
      const hours = Math.floor((timeSinceLock % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      
      console.log(`\nLocked At: ${lockDate.toISOString()}`);
      console.log(`Time Since Lock: ${days}d ${hours}h ago`);
      console.log(`\n✅ You can request withdrawal anytime (no minimum lock period)`);
    }

  } catch (error) {
    console.error('\nError:', error);
  }
}

checkLockTime();
