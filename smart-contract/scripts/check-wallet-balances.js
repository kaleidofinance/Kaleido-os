require('dotenv').config();
const { ethers } = require('ethers');

// Contract addresses
const CONTRACTS = {
  kfUSD: '0x913f3354942366809A05e89D288cCE60d87d7348',
  kafUSD: '0x8B8F59E9404235c9dF06305d87416457e46e0561',
  USDC: '0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3',
  USDT: '0x717A36E56b33585Bd00260422FfCc3270af34D3E',
  USDe: '0x2F7744E8fcc75F8F26Ea455968556591091cb46F'
};

// Your wallet address (replace with actual address if different)
const WALLET_ADDRESS = process.env.WALLET_ADDRESS || '0xYourWalletAddressHere';

// ERC20 ABI (balanceOf function)
const erc20Abi = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

async function checkBalances() {
  try {
    const provider = new ethers.JsonRpcProvider('https://api.testnet.abs.xyz', {
      chainId: 11124,
      name: 'abstract-testnet'
    });

    console.log('\\n=== Checking Wallet Balances ===');
    console.log(`Wallet: ${WALLET_ADDRESS}\\n`);

    for (const [name, address] of Object.entries(CONTRACTS)) {
      const contract = new ethers.Contract(address, erc20Abi, provider);
      
      try {
        const [balance, decimals, symbol] = await Promise.all([
          contract.balanceOf(WALLET_ADDRESS),
          contract.decimals(),
          contract.symbol()
        ]);

        const formattedBalance = ethers.formatUnits(balance, decimals);
        console.log(`${symbol} (${name}):`);
        console.log(`  Balance: ${formattedBalance}`);
        console.log(`  Address: ${address}\\n`);
      } catch (error) {
        console.error(`Error fetching ${name}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

checkBalances();
