require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { ethers } = require('ethers');

// Contract addresses
const KAFUSD_ADDRESS = '0x601191730174c2651E76dC69325681a5A5D5B9a6';

// ABI for kafUSD admin functions
const kafUSDAbi = [
  'function setAssetSupport(address asset, bool supported) external',
  'function supportedAssets(address asset) view returns (bool)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)'
];

// Assets to add as supported
const ASSETS_TO_ADD = {
  'kfUSD': '0x913f3354942366809A05e89D288cCE60d87d7348',
  'USDC': '0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3',
  'USDT': '0x717A36E56b33585Bd00260422FfCc3270af34D3E',
  'USDe': '0x2F7744E8fcc75F8F26Ea455968556591091cb46F'
};

async function addSupportedAssets() {
  try {
    if (!process.env.PRIVATE_KEY) {
      console.error('❌ PRIVATE_KEY not found in .env file');
      return;
    }

    const provider = new ethers.JsonRpcProvider('https://api.testnet.abs.xyz', {
      chainId: 11124,
      name: 'abstract-testnet'
    });

    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const kafUSDContract = new ethers.Contract(KAFUSD_ADDRESS, kafUSDAbi, wallet);

    console.log('\\n=== Adding Supported Assets to kafUSD ===');
    console.log(`kafUSD Contract: ${KAFUSD_ADDRESS}`);
    console.log(`Deployer Address: ${wallet.address}\\n`);

    // Check admin role
    const adminRole = await kafUSDContract.DEFAULT_ADMIN_ROLE();
    const hasAdmin = await kafUSDContract.hasRole(adminRole, wallet.address);
    console.log(`Has DEFAULT_ADMIN_ROLE: ${hasAdmin ? '✅' : '❌'}\\n`);

    if (!hasAdmin) {
      console.error('❌ Wallet does not have DEFAULT_ADMIN_ROLE. Cannot add supported assets.');
      return;
    }

    // Add each asset
    for (const [name, address] of Object.entries(ASSETS_TO_ADD)) {
      console.log(`Processing ${name} (${address})...`);
      
      // Check if already supported
      const isAlreadySupported = await kafUSDContract.supportedAssets(address);
      if (isAlreadySupported) {
        console.log(`  ✅ Already supported, skipping\\n`);
        continue;
      }

      // Add support
      console.log(`  📝 Adding support...`);
      const tx = await kafUSDContract.setAssetSupport(address, true);
      console.log(`  ⏳ Transaction sent: ${tx.hash}`);
      
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        console.log(`  ✅ Success! ${name} is now supported\\n`);
      } else {
        console.log(`  ❌ Transaction failed\\n`);
      }
    }

    // Verify all assets are now supported
    console.log('\\n=== Verification ===');
    for (const [name, address] of Object.entries(ASSETS_TO_ADD)) {
      const isSupported = await kafUSDContract.supportedAssets(address);
      console.log(`${name}: ${isSupported ? '✅ SUPPORTED' : '❌ NOT SUPPORTED'}`);
    }

  } catch (error) {
    console.error('\\nError:', error);
  }
}

addSupportedAssets();
