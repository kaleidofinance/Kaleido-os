# Stablecoin Contracts Deployment - Abstract Testnet

## ✅ Deployment Successful!

All stablecoin contracts have been successfully deployed to Abstract Testnet.

## Deployed Contracts

### Core Contracts

1. **USDT** (Test Token)
   - Address: `0x717A36E56b33585Bd00260422FfCc3270af34D3E`
   - Decimals: 6
   - Purpose: Test token for kfUSD collateral

2. **USDe** (Test Token)
   - Address: `0x2F7744E8fcc75F8F26Ea455968556591091cb46F`
   - Decimals: 18
   - Purpose: Test token for kfUSD collateral

3. **kfUSD** (Stablecoin)
   - Address: `0xf55C1Bc56618e9b47479b9B650A540Bc9b218ed1`
   - Decimals: 18
   - Purpose: Multi-collateral stablecoin
   - Features:
     - Mint with USDC, USDT, USDe
     - Redeem to any supported collateral
     - Automatic fee transfer to YieldTreasury ✅
     - Fees: 0.3% mint, 0.3% redeem

4. **kafUSD** (Liquid Staking Token)
   - Address: `0x601191730174c2651E76dC69325681a5A5D5B9a6`
   - Decimals: 18
   - Purpose: Liquid staking derivative of kfUSD
   - Features:
     - Lock kfUSD to receive kafUSD
     - Earn yield over time
     - 7-day cooldown for withdrawals
     - Yield from YieldTreasury

5. **YieldTreasury** (Yield Management)
   - Address: `0x9977ac5FDdb3B3B8bB22d438b3177F8EA8d4A809`
   - Purpose: Centralized yield management
   - Features:
     - Multi-asset yield support
     - Multiple yield sources
     - User yield calculation
     - Yield claiming and compounding

### External Contracts

- **USDC**: `0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3` (Official USDC on Abstract Testnet)

## Configuration

### kfUSD Configuration

✅ **Supported Collaterals:**
- USDC: `0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3`
- USDT: `0x717A36E56b33585Bd00260422FfCc3270af34D3E`
- USDe: `0x2F7744E8fcc75F8F26Ea455968556591091cb46F`

✅ **YieldTreasury Integration:**
- YieldTreasury address: `0x9977ac5FDdb3B3B8bB22d438b3177F8EA8d4A809`
- Auto-transfer fees: **Enabled** ✅
- Fees automatically sent to YieldTreasury on mint/redeem

### kafUSD Configuration

✅ **Supported Assets:**
- USDC: `0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3`
- kfUSD: `0xf55C1Bc56618e9b47479b9B650A540Bc9b218ed1`
- USDT: `0x717A36E56b33585Bd00260422FfCc3270af34D3E`
- USDe: `0x2F7744E8fcc75F8F26Ea455968556591091cb46F`

✅ **YieldTreasury Integration:**
- YieldTreasury address: `0x9977ac5FDdb3B3B8bB22d438b3177F8EA8d4A809`

### YieldTreasury Configuration

✅ **Yield Sources:**
- kfUSD: Registered as "kfUSD Fees" ✅

✅ **Supported Yield Assets:**
- kfUSD: `0xf55C1Bc56618e9b47479b9B650A540Bc9b218ed1`
- USDC: `0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3`
- USDT: `0x717A36E56b33585Bd00260422FfCc3270af34D3E`
- USDe: `0x2F7744E8fcc75F8F26Ea455968556591091cb46F`

✅ **Roles:**
- YIELD_SOURCE_ROLE: Granted to kfUSD contract ✅

## Deployment Details

- **Network**: Abstract Testnet
- **Chain ID**: 11124
- **Deployer**: `0x28b7b3dc96e5b2C6047D7Ad9b05Fd9E2FC7E8955`
- **Deployment Time**: Successfully deployed
- **Compiler**: zksolc v1.5.15, zkvm-solc v0.8.24-1.0.2

## Next Steps

1. ✅ **Contracts Deployed** - All stablecoin contracts deployed
2. ✅ **YieldTreasury Configured** - kfUSD registered as yield source
3. ✅ **Auto-transfer Enabled** - Fees automatically sent to YieldTreasury
4. ✅ **Collaterals Added** - USDC, USDT, USDe added as collaterals
5. ✅ **Assets Added** - All assets added to kafUSD

## Testing

You can now:
1. Mint kfUSD with USDC/USDT/USDe
2. Lock kfUSD to receive kafUSD
3. Fees automatically sent to YieldTreasury
4. Users can claim yield from YieldTreasury
5. Users can compound yield back to kafUSD

## Contract Addresses Summary

```
USDT:         0x717A36E56b33585Bd00260422FfCc3270af34D3E
USDe:         0x2F7744E8fcc75F8F26Ea455968556591091cb46F
kfUSD:        0xf55C1Bc56618e9b47479b9B650A540Bc9b218ed1
kafUSD:       0x601191730174c2651E76dC69325681a5A5D5B9a6
YieldTreasury: 0x9977ac5FDdb3B3B8bB22d438b3177F8EA8d4A809
USDC:         0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3
```

## Notes

- All contracts compiled successfully
- All contracts deployed successfully
- All configurations completed
- Auto-fee transfer enabled
- Ready for testing and use

