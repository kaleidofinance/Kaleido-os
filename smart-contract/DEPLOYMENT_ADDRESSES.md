# Stablecoin Contracts - Abstract Testnet Deployment Addresses

## ✅ Deployment Successful!

**Network**: Abstract Testnet  
**Chain ID**: 11124  
**Deployer**: `0x28b7b3dc96e5b2C6047D7Ad9b05Fd9E2FC7E8955`

## Contract Addresses

### Core Stablecoin Contracts

| Contract | Address | Purpose |
|----------|---------|---------|
| **kfUSD** | `0xf55C1Bc56618e9b47479b9B650A540Bc9b218ed1` | Multi-collateral stablecoin |
| **kafUSD** | `0x601191730174c2651E76dC69325681a5A5D5B9a6` | Liquid staking token |
| **YieldTreasury** | `0x9977ac5FDdb3B3B8bB22d438b3177F8EA8d4A809` | Yield management |

### Test Tokens

| Contract | Address | Purpose |
|----------|---------|---------|
| **USDT** | `0x717A36E56b33585Bd00260422FfCc3270af34D3E` | Test token (6 decimals) |
| **USDe** | `0x2F7744E8fcc75F8F26Ea455968556591091cb46F` | Test token (18 decimals) |

### External Contracts

| Contract | Address | Purpose |
|----------|---------|---------|
| **USDC** | `0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3` | Official USDC (Abstract Testnet) |

## Configuration Status

### ✅ kfUSD Configuration
- ✅ YieldTreasury: `0x9977ac5FDdb3B3B8bB22d438b3177F8EA8d4A809`
- ✅ Auto-transfer fees: **Enabled**
- ✅ Supported collaterals: USDC, USDT, USDe
- ✅ Mint fee: 0.3%
- ✅ Redeem fee: 0.3%

### ✅ kafUSD Configuration
- ✅ YieldTreasury: `0x9977ac5FDdb3B3B8bB22d438b3177F8EA8d4A809`
- ✅ Supported assets: USDC, kfUSD, USDT, USDe
- ✅ Cooldown period: 7 days

### ✅ YieldTreasury Configuration
- ✅ kafUSD contract: `0x601191730174c2651E76dC69325681a5A5D5B9a6`
- ✅ kfUSD token: `0xf55C1Bc56618e9b47479b9B650A540Bc9b218ed1`
- ✅ Yield sources: kfUSD (registered as "kfUSD Fees")
- ✅ Supported yield assets: kfUSD, USDC, USDT, USDe
- ✅ YIELD_SOURCE_ROLE: Granted to kfUSD contract

## Quick Reference

```solidity
// Contract Addresses
address constant USDT = 0x717A36E56b33585Bd00260422FfCc3270af34D3E;
address constant USDe = 0x2F7744E8fcc75F8F26Ea455968556591091cb46F;
address constant kfUSD = 0xf55C1Bc56618e9b47479b9B650A540Bc9b218ed1;
address constant kafUSD = 0x601191730174c2651E76dC69325681a5A5D5B9a6;
address constant YieldTreasury = 0x9977ac5FDdb3B3B8bB22d438b3177F8EA8d4A809;
address constant USDC = 0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3;
```

## Deployment Date

Deployed: Successfully deployed to Abstract Testnet

## Next Steps

1. ✅ Contracts deployed
2. ✅ Configuration completed
3. ✅ Auto-fee transfer enabled
4. ⏭️ Test minting kfUSD
5. ⏭️ Test locking kfUSD to receive kafUSD
6. ⏭️ Test yield claiming from YieldTreasury

## Notes

- All contracts compiled successfully with zksolc
- All contracts deployed successfully
- All configurations completed
- Auto-fee transfer to YieldTreasury enabled
- Ready for testing

