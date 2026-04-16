require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { ethers } = require('ethers');

// Contract addresses
const YIELD_TREASURY = '0x9977ac5FDdb3B3B8bB22d438b3177F8EA8d4A809';
const KFUSD_ADDRESS = '0x913f3354942366809A05e89D288cCE60d87d7348';

// Amount to fund (in kfUSD) - let's add 1,000 kfUSD as test yield
const FUND_AMOUNT = '1000';

// ABIs
const yieldTreasuryAbi = [
  'function receiveYield(address asset, uint256 amount, string memory sourceName) external',
  'function getYieldBalance(address asset) view returns (uint256)',
  'function YIELD_SOURCE_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function grantRole(bytes32 role, address account) external'
];

const kfUSDAbi = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function mint(address to, uint256 amount, address collateralToken, uint256 collateralAmount) external',
  'function MINTER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)'
];

async function fundYieldTreasury() {
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
    const yieldTreasuryContract = new ethers.Contract(YIELD_TREASURY, yieldTreasuryAbi, wallet);
    const kfUSDContract = new ethers.Contract(KFUSD_ADDRESS, kfUSDAbi, wallet);

    console.log('\n=== Funding YieldTreasury for Testing ===');
    console.log(`Wallet Address: ${wallet.address}`);
    console.log(`YieldTreasury: ${YIELD_TREASURY}`);
    console.log(`Amount to Fund: ${FUND_AMOUNT} kfUSD\n`);

    // Step 1: Check current balances
    console.log('--- Current State ---');
    const [walletBalance, currentYieldBalance] = await Promise.all([
      kfUSDContract.balanceOf(wallet.address),
      yieldTreasuryContract.getYieldBalance(KFUSD_ADDRESS)
    ]);
    
    console.log(`Your kfUSD Balance: ${ethers.formatUnits(walletBalance, 18)}`);
    console.log(`YieldTreasury kfUSD Balance: ${ethers.formatUnits(currentYieldBalance, 18)}\n`);

    if (Number(walletBalance) === 0) {
      console.log('⚠️  You have no kfUSD. You need to mint some first.');
      console.log('Run: node smart-contract/scripts/mint-kfusd.js\n');
      return;
    }

    // Step 2: Check if wallet has YIELD_SOURCE_ROLE
    console.log('--- Checking Permissions ---');
    const yieldSourceRole = await yieldTreasuryContract.YIELD_SOURCE_ROLE();
    const hasYieldSourceRole = await yieldTreasuryContract.hasRole(yieldSourceRole, wallet.address);
    
    console.log(`Has YIELD_SOURCE_ROLE: ${hasYieldSourceRole ? '✅' : '❌'}\n`);

    if (!hasYieldSourceRole) {
      console.log('📝 Granting YIELD_SOURCE_ROLE to your wallet...');
      const grantTx = await yieldTreasuryContract.grantRole(yieldSourceRole, wallet.address);
      console.log(`⏳ Transaction sent: ${grantTx.hash}`);
      await grantTx.wait();
      console.log('✅ Role granted!\n');
    }

    // Step 3: Approve YieldTreasury to spend kfUSD
    console.log('--- Approving YieldTreasury ---');
    const amountToFund = ethers.parseUnits(FUND_AMOUNT, 18);
    const approveTx = await kfUSDContract.approve(YIELD_TREASURY, amountToFund);
    console.log(`⏳ Approval transaction: ${approveTx.hash}`);
    await approveTx.wait();
    console.log('✅ Approved!\n');

    // Step 4: Call receiveYield
    console.log('--- Sending Yield to Treasury ---');
    const receiveTx = await yieldTreasuryContract.receiveYield(
      KFUSD_ADDRESS,
      amountToFund,
      'Test Yield Funding'
    );
    console.log(`⏳ Transaction sent: ${receiveTx.hash}`);
    const receipt = await receiveTx.wait();
    
    if (receipt.status === 1) {
      console.log('✅ Success! Yield added to treasury\n');
    } else {
      console.log('❌ Transaction failed\n');
      return;
    }

    // Step 5: Verify new balance
    console.log('--- Verification ---');
    const [newWalletBalance, newYieldBalance] = await Promise.all([
      kfUSDContract.balanceOf(wallet.address),
      yieldTreasuryContract.getYieldBalance(KFUSD_ADDRESS)
    ]);
    
    console.log(`Your kfUSD Balance: ${ethers.formatUnits(newWalletBalance, 18)}`);
    console.log(`YieldTreasury kfUSD Balance: ${ethers.formatUnits(newYieldBalance, 18)}\n`);
    
    console.log('🎉 YieldTreasury is now funded!');
    console.log('Users can now claim their share of the yield.\n');

  } catch (error) {
    console.error('\nError:', error);
    if (error.message.includes('insufficient funds')) {
      console.log('\n💡 Tip: Make sure your wallet has enough ETH for gas fees');
    }
  }
}

fundYieldTreasury();
