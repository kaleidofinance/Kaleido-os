require('dotenv').config();
const { ethers } = require('ethers');

// Contract addresses
const KAFUSD_ADDRESS = '0x601191730174c2651E76dC69325681a5A5D5B9a6';

// ABI for kafUSD
const kafUSDAbi = [
  'function supportedAssets(address asset) view returns (bool)',
  'function getSupportedAssets() view returns (address[])',
  'function assetList(uint256 index) view returns (address)'
];

// Assets to check
const ASSETS = {
  'kfUSD': '0x913f3354942366809A05e89D288cCE60d87d7348',
  'USDC': '0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3',
  'USDT': '0x717A36E56b33585Bd00260422FfCc3270af34D3E',
  'USDe': '0x2F7744E8fcc75F8F26Ea455968556591091cb46F'
};

async function checkSupportedAssets() {
  try {
    const provider = new ethers.JsonRpcProvider('https://api.testnet.abs.xyz', {
      chainId: 11124,
      name: 'abstract-testnet'
    });

    const kafUSDContract = new ethers.Contract(
      ethers.getAddress(KAFUSD_ADDRESS), 
      kafUSDAbi, 
      provider
    );

    console.log('\\n=== kafUSD Supported Assets Check ===');
    console.log(`kafUSD Contract: ${KAFUSD_ADDRESS}\\n`);

    // Check individual assets
    console.log('Individual Asset Support Status:');
    for (const [name, address] of Object.entries(ASSETS)) {
      try {
        const isSupported = await kafUSDContract.supportedAssets(ethers.getAddress(address));
        console.log(`  ${name} (${address}): ${isSupported ? '✅ SUPPORTED' : '❌ NOT SUPPORTED'}`);
      } catch (error) {
        console.log(`  ${name}: Error checking - ${error.message}`);
      }
    }

    // Try to get full list of supported assets
    console.log('\\nAttempting to fetch full supported assets list...');
    try {
      const supportedAssetsList = await kafUSDContract.getSupportedAssets();
      if (supportedAssetsList.length > 0) {
        console.log(`Found ${supportedAssetsList.length} supported asset(s):`);
        supportedAssetsList.forEach((addr, idx) => {
          console.log(`  [${idx}]: ${addr}`);
        });
      } else {
        console.log('⚠️  No assets are currently configured as supported!');
      }
    } catch (error) {
      console.log(`Error fetching list: ${error.message}`);
    }

  } catch (error) {
    console.error('\\nError:', error);
  }
}

checkSupportedAssets();
