# How to Redeem kfUSD

## Why You See "Insufficient Collateral" Error

The error occurs because the kfUSD contract doesn't have any USDC collateral deposited yet. 

### How kfUSD Works

1. **Mint kfUSD**: You deposit USDC/USDT/USDe → Receive kfUSD
2. **This deposits collateral** into the contract
3. **Then you can redeem** kfUSD back to original assets

### Problem

You're trying to redeem kfUSD **before** minting it, so there's no collateral in the contract.

## Solution

### Step 1: Mint kfUSD First

1. Go to the `/stable` page
2. Select **"Mint"** tab
3. Choose **USDC** as input
4. Enter amount (e.g., 1000 USDC)
5. Click **"Mint kfUSD"**

This will:
- Deposit 1000 USDC into the kfUSD contract
- Give you ~997 kfUSD (minus 0.3% fee)
- Make USDC available for redemption

### Step 2: Then Redeem (Optional)

After you have kfUSD, you can:
1. Select **"Redeem"** tab  
2. Enter amount of kfUSD to redeem
3. Select **USDC** as output
4. Click **"Redeem kfUSD"**

This will:
- Burn your kfUSD
- Return USDC from the idle collateral pool
- Give you ~997 USDC (minus 0.3% fee)

## Current Balances in Contract

Check the `/stable` page stats:
- **Total Stable Deposited**: Shows how much collateral is in the contract
- **kfUSD Total Supply**: Shows how much kfUSD has been minted
- **Total Value Locked**: Total value of all collateral

If these are all $0, you need to **mint first**.

## Deployer Wallet Setup

If you're the deployer and want to seed the contract:

1. Mint a large amount of kfUSD (e.g., 1M USDC)
2. This makes the pool liquid for redemptions
3. Users can then mint/redeem as needed

## Testing Flow

```
1. Deploy contracts ✅
2. Mint USDC → kfUSD (required first step)
3. This deposits USDC into the contract ✅
4. Then you can redeem kfUSD → USDC ✅
```

**Important:** You cannot redeem more kfUSD than what was minted (the collateral backing).

## Summary

- ❌ **Cannot redeem** without minting first
- ✅ **Must mint** kfUSD to deposit collateral
- ✅ **Then can redeem** kfUSD for collateral

The contract requires active collateral to support redemptions!

