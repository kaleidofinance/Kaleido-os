#!/bin/bash

# Deployment script for Abstract Testnet
# This script deploys contracts and updates addresses

set -e

echo "🚀 Starting deployment to Abstract Testnet..."

# Step 1: Archive old deployment file
if [ -f "deployment-abstractTestnet-*.json" ]; then
    echo "📦 Archiving old deployment file..."
    mkdir -p archive
    mv deployment-abstractTestnet-*.json archive/ 2>/dev/null || true
    echo "✅ Old deployment file archived"
fi

# Step 2: Deploy contracts
echo "📝 Deploying contracts..."
npx hardhat run scripts/deploy-stablecoin.js --network abstractTestnet

# Step 3: Get the latest deployment file
LATEST_DEPLOYMENT=$(ls -t deployment-abstractTestnet-*.json | head -1)
echo "📄 Latest deployment file: $LATEST_DEPLOYMENT"

# Step 4: Extract addresses
KFUSD_ADDRESS=$(cat $LATEST_DEPLOYMENT | grep -o '"kfUSD": "[^"]*"' | cut -d'"' -f4)
KAFUSD_ADDRESS=$(cat $LATEST_DEPLOYMENT | grep -o '"kafUSD": "[^"]*"' | cut -d'"' -f4)
YIELDTREASURY_ADDRESS=$(cat $LATEST_DEPLOYMENT | grep -o '"YieldTreasury": "[^"]*"' | cut -d'"' -f4)

echo "✅ Deployment complete!"
echo "📋 New addresses:"
echo "  kfUSD: $KFUSD_ADDRESS"
echo "  kafUSD: $KAFUSD_ADDRESS"
echo "  YieldTreasury: $YIELDTREASURY_ADDRESS"

# Step 5: Update addresses in codebase
echo "🔄 Updating addresses in codebase..."
node scripts/update-addresses.js $KFUSD_ADDRESS $KAFUSD_ADDRESS $YIELDTREASURY_ADDRESS

echo "✅ All done! Addresses updated."

