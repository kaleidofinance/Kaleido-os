# Kaleido Stablecoin System

## Overview

The Kaleido stablecoin system consists of two main tokens:

1. **kfUSD** - Kaleido Finance USD Stablecoin
2. **kafUSD** - Kaleido Finance Liquid Staked USD

## Contracts

### kfUSD (Stablecoin)

A collateralized stablecoin backed by multiple stable assets:
- USDC
- USDT  
- USDe (Ethena USD)

#### Features

- **Multi-collateral**: Backed by USDC, USDT, and USDe
- **Minting**: Users can mint kfUSD by depositing supported collateral
- **Redemption**: Users can redeem kfUSD for any supported collateral
- **Fee System**: 0.1-0.3% mint and redemption fees (configurable)
- **Backing Ratio**: Maintains over-collateralization

#### Key Functions

```solidity
// Mint kfUSD with collateral
function mint(address _to, uint256 _amount, address _collateralToken, uint256 _collateralAmount)

// Redeem kfUSD for output asset
function redeem(uint256 _amount, address _outputToken)

// Get backing ratio
function getBackingRatio() returns (uint256)

// Get total collateral value
function getTotalCollateralValue() returns (uint256)
```

### kafUSD (Liquid Staking Token)

A yield-bearing liquid staking derivative of kfUSD:

#### Features

- **Liquid Staking**: Lock kfUSD (or other supported assets) to receive kafUSD
- **Yield Generation**: Earn yield on locked assets (configurable APY)
- **Cooldown Period**: 7-day cooldown for withdrawals
- **Multiple Assets**: Can lock kfUSD, USDT, USDe, etc.

#### Key Functions

```solidity
// Lock assets to receive kafUSD
function lockAssets(address _asset, uint256 _amount)

// Request withdrawal
function requestWithdrawal(uint256 _amount)

// Complete withdrawal after cooldown
function completeWithdrawal(address _asset)

// Get user's locked balance
function getUserAssetBalance(address _user, address _asset) returns (uint256)
```

### Collateral Tokens

#### USDC
- **Symbol**: USDC
- **Decimals**: 6
- **Purpose**: Primary collateral asset
- **Network**: Abstract Chain (official USDC address from dashboard)

#### USDT
- **Symbol**: USDT
- **Decimals**: 6
- **Purpose**: Tether USD collateral asset
- **Total Supply**: 1 billion USDT

#### USDe
- **Symbol**: USDe
- **Decimals**: 18
- **Purpose**: Ethena USD collateral asset
- **Total Supply**: 1 billion USDe

## Deployment

### Deploy Stablecoin Contracts

```bash
cd smart-contract
npx hardhat run scripts/deploy-stablecoin.js --network abstractTestnet
```

This will deploy:
1. USDT token
2. USDe token
3. kfUSD stablecoin
4. kafUSD liquid staking token

### Configure Collaterals

After deployment, the contracts are automatically configured with:
- USDC (official address from dashboard)
- USDT
- USDe

## Architecture

```
User Deposits (USDC/USDT/USDe)
         ↓
    Mint kfUSD
         ↓
   Lock kfUSD
         ↓
 Receive kafUSD
         ↓
   Earn Yield
         ↓
  Withdraw (7-day cooldown)
```

## Fee Structure

### kfUSD
- **Mint Fee**: 0.3% (30 basis points) - Configurable
- **Redeem Fee**: 0.3% (30 basis points) - Configurable

### kafUSD
- **Yield APY**: 5% - Configurable
- **Withdrawal Cooldown**: 7 days - Configurable

## Security Features

- Access Control (Role-Based)
- ReentrancyGuard protection
- Pausable functionality
- Fee limits (max 1%)
- Over-collateralization checks

## Usage Examples

### Mint kfUSD

1. Approve collateral token to kfUSD contract
2. Call `mint()` with:
   - Recipient address
   - Amount of kfUSD to mint
   - Collateral token address
   - Collateral amount

### Redeem kfUSD

1. Approve kfUSD to the contract
2. Call `redeem()` with:
   - Amount of kfUSD to redeem
   - Output token address

### Stake to kafUSD

1. Lock assets by calling `lockAssets()`
2. Receive kafUSD in return (1:1 ratio)
3. Earn yield over time

### Unstake kafUSD

1. Request withdrawal with `requestWithdrawal()`
2. Wait for cooldown period (7 days)
3. Complete withdrawal with `completeWithdrawal()`

## Configuration

### Update USDC Address

Edit `deploy-stablecoin.js`:
```javascript
const USDC_ADDRESS = "YOUR_OFFICIAL_USDC_ADDRESS";
```

### Update Fee/APY

```javascript
// For kfUSD
await kfusd.setFees(30, 30); // 0.3% each

// For kafUSD
await kafusd.setYieldAPY(500); // 5% APY
```

## Testing

To test the contracts locally:

```bash
npx hardhat test
```

## Network Configuration

Contracts are configured for:
- Abstract Testnet (chainId: 11124)
- Abstract Mainnet (chainId: 2741)

## License

MIT

