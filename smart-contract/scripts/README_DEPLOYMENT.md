# Deployment Instructions

## Prerequisites

1. Node.js and npm installed
2. Hardhat configured
3. Network configuration in `hardhat.config.js`
4. Private key in hardhat config (or environment variable)

## Deploy to Abstract Testnet

### Option 1: Automated Script (Recommended)

```bash
cd kaleido-main/smart-contract
./scripts/deploy-and-update.sh
```

### Option 2: Manual Deployment

#### Step 1: Archive Old Deployment

```bash
cd kaleido-main/smart-contract
mkdir -p archive
mv deployment-abstractTestnet-*.json archive/ 2>/dev/null || true
```

#### Step 2: Deploy Contracts

```bash
npx hardhat run scripts/deploy-stablecoin.js --network abstractTestnet
```

This will:
- Deploy all contracts (USDT, USDe, kfUSD, kafUSD, **YieldTreasury**)
- Configure YieldTreasury
- Configure kfUSD and kafUSD
- Save deployment info to JSON file

#### Step 3: Update Addresses

After deployment, get the new addresses from the deployment JSON file, then:

```bash
# Get addresses from deployment file
NEW_KFUSD=$(cat deployment-abstractTestnet-*.json | grep -o '"kfUSD": "[^"]*"' | cut -d'"' -f4)
NEW_KAFUSD=$(cat deployment-abstractTestnet-*.json | grep -o '"kafUSD": "[^"]*"' | cut -d'"' -f4)
NEW_YIELDTREASURY=$(cat deployment-abstractTestnet-*.json | grep -o '"YieldTreasury": "[^"]*"' | cut -d'"' -f4)

# Update addresses in codebase
node scripts/update-addresses.js $NEW_KFUSD $NEW_KAFUSD $NEW_YIELDTREASURY
```

Or manually update addresses in:
- `src/hooks/useStablecoin.ts`
- `src/components/stable/LockWithdraw.tsx`
- `src/components/stable/YieldVaults.tsx`
- `src/components/stable/TransactionHistoryModal.tsx`
- `src/lib/x402/pricing.ts`
- `README.md`
- `smart-contract/README.md`
- `DEX_INTEGRATION_PACKAGE.md`
- `STABLECOIN_LAUNCH_PARTNERSHIP.md`
- `DEPLOYMENT_STRATEGY.md`

**Old Addresses to Replace:**
- kfUSD: `0x7f815685a7D686Ced7AE695c01974425C4ee7790`
- kafUSD: `0x8e78C32eFE55e77335f488dd0bf87A8Eb9d39D6c`

#### Step 4: Verify Deployment

```bash
# Check YieldTreasury
npx hardhat run scripts/check-yield-treasury.js --network abstractTestnet

# Check contract state
npx hardhat run scripts/check-contract-state.js --network abstractTestnet
```

## What Gets Deployed

1. **USDT Token** - Test token
2. **USDe Token** - Test token
3. **kfUSD Stablecoin** - Main stablecoin contract
4. **kafUSD Liquid Staking Token** - Liquid staking contract
5. **YieldTreasury** - NEW: Centralized yield management

## Configuration

After deployment, the script automatically:
- ✅ Grants YIELD_SOURCE_ROLE to kfUSD
- ✅ Registers kfUSD as yield source
- ✅ Adds supported yield assets (kfUSD, USDC, USDT, USDe)
- ✅ Sets YieldTreasury in kfUSD
- ✅ Enables auto-transfer in kfUSD
- ✅ Sets YieldTreasury in kafUSD
- ✅ Configures collaterals and assets

## Troubleshooting

### Deployment Fails
- Check network connection
- Verify account balance
- Check gas limits
- Verify hardhat config

### Address Update Fails
- Manually update addresses
- Check file paths
- Verify addresses are valid

### Contracts Not Working
- Verify YieldTreasury configuration
- Check roles are granted
- Verify auto-transfer is enabled
- Check contract addresses

## Next Steps

After deployment:
1. ✅ Verify all contracts
2. ✅ Test minting/redeeming
3. ✅ Test yield claiming
4. ✅ Update frontend
5. ✅ Update documentation

