const fs = require('fs');
const path = require('path');

// Get new addresses from command line arguments
const newKfUSD = process.argv[2];
const newKafUSD = process.argv[3];
const newYieldTreasury = process.argv[4];

// Old addresses
const oldKfUSD = '0x7f815685a7D686Ced7AE695c01974425C4ee7790';
const oldKafUSD = '0x8e78C32eFE55e77335f488dd0bf87A8Eb9d39D6c';

if (!newKfUSD || !newKafUSD) {
  console.error('Usage: node update-addresses.js <kfUSD_address> <kafUSD_address> [yieldTreasury_address]');
  process.exit(1);
}

console.log('🔄 Updating contract addresses...');
console.log(`  Old kfUSD: ${oldKfUSD}`);
console.log(`  New kfUSD: ${newKfUSD}`);
console.log(`  Old kafUSD: ${oldKafUSD}`);
console.log(`  New kafUSD: ${newKafUSD}`);
if (newYieldTreasury) {
  console.log(`  New YieldTreasury: ${newYieldTreasury}`);
}

// Files to update
const filesToUpdate = [
  '../src/hooks/useStablecoin.ts',
  '../src/components/stable/LockWithdraw.tsx',
  '../src/components/stable/YieldVaults.tsx',
  '../src/components/stable/TransactionHistoryModal.tsx',
  '../src/lib/x402/pricing.ts',
  '../README.md',
  '../smart-contract/README.md',
  '../DEX_INTEGRATION_PACKAGE.md',
  '../STABLECOIN_LAUNCH_PARTNERSHIP.md',
  '../DEPLOYMENT_STRATEGY.md',
];

let updatedCount = 0;

filesToUpdate.forEach(filePath => {
  const fullPath = path.join(__dirname, filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  let modified = false;

  // Replace kfUSD address
  if (content.includes(oldKfUSD)) {
    content = content.replace(new RegExp(oldKfUSD, 'g'), newKfUSD);
    modified = true;
  }

  // Replace kafUSD address
  if (content.includes(oldKafUSD)) {
    content = content.replace(new RegExp(oldKafUSD, 'g'), newKafUSD);
    modified = true;
  }

  // Add YieldTreasury address if provided
  if (newYieldTreasury && content.includes('YieldTreasury')) {
    // Look for YieldTreasury address pattern and update
    const yieldTreasuryRegex = /(YieldTreasury[":\s]*["\']?)(0x[a-fA-F0-9]{40})(["\']?)/g;
    if (yieldTreasuryRegex.test(content)) {
      content = content.replace(yieldTreasuryRegex, `$1${newYieldTreasury}$3`);
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`✅ Updated: ${filePath}`);
    updatedCount++;
  } else {
    console.log(`⏭️  Skipped: ${filePath} (no changes needed)`);
  }
});

console.log(`\n✅ Updated ${updatedCount} files`);

