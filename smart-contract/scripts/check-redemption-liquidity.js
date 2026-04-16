require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { ethers } = require('ethers');

const KFUSD_CONTRACT = '0x913f3354942366809A05e89D288cCE60d87d7348';

const COLLATERAL_ASSETS = {
  'USDC': '0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3',
  'USDT': '0x717A36E56b33585Bd00260422FfCc3270af34D3E',
  'USDe': '0x2F7744E8fcc75F8F26Ea455968556591091cb46F'
};

const kfUSDAbi = [
  'function getBalances(address token) view returns (uint256 idle, uint256 deployed)',
  'function collateralBalances(address token) view returns (uint256)',
  'function totalSupply() view returns (uint256)'
];

const erc20Abi = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)'
];

async function checkIdleLiquidity() {
  try {
    const provider = new ethers.JsonRpcProvider('https://api.testnet.abs.xyz', {
      chainId: 11124,
      name: 'abstract-testnet'
    });

    const kfUSDContract = new ethers.Contract(KFUSD_CONTRACT, kfUSDAbi, provider);

    console.log('\n=== kfUSD Idle Collateral Check ===\n');

    const totalSupply = await kfUSDContract.totalSupply();
    console.log(`Total kfUSD Supply: ${ethers.formatUnits(totalSupply, 18)}\n`);

    console.log('Collateral Status (Idle vs Deployed):\n');

    for (const [name, address] of Object.entries(COLLATERAL_ASSETS)) {
      try {
        const [idle, deployed] = await kfUSDContract.getBalances(address);
        const total = await kfUSDContract.collateralBalances(address);
        
        const assetContract = new ethers.Contract(address, erc20Abi, provider);
        const decimals = await assetContract.decimals();
        
        const idleFormatted = parseFloat(ethers.formatUnits(idle, decimals));
        const deployedFormatted = parseFloat(ethers.formatUnits(deployed, decimals));
        const totalFormatted = parseFloat(ethers.formatUnits(total, decimals));

        console.log(`${name}:`);
        console.log(`  Total: ${totalFormatted.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        console.log(`  Idle (available for redemption): ${idleFormatted.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${idleFormatted > 0 ? '✅' : '⚠️'}`);
        console.log(`  Deployed (earning yield): ${deployedFormatted.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        
        if (idleFormatted > 0) {
          console.log(`  💡 Can redeem up to ${Math.floor(idleFormatted).toLocaleString('en-US')} kfUSD to ${name}`);
        } else {
          console.log(`  ⚠️  Cannot redeem to ${name} - no idle liquidity`);
        }
        console.log('');
        
      } catch (error) {
        console.log(`${name}: Error - ${error.message}\n`);
      }
    }

  } catch (error) {
    console.error('\nError:', error);
  }
}

checkIdleLiquidity();
