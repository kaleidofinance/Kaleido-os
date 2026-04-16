# Featured Pool Integration for kfUSD Collateral

## Overview

This feature allows kfUSD collateral deposits to be automatically deployed as **Featured Pool Lending** on the Kaleido marketplace. These pools appear at the top of the borrow listings with a "FEATURED" badge.

## How It Works

### Traditional P2P Model:
- Lender creates listing → Borrower requests → Manual matching
- One listing = one match

### Featured Pool Model (Hybrid):
- Vault creates large listing (e.g., $1M USDC) → Anyone can borrow from it
- Acts like Aave/Compound pool: continuous borrowing from same source
- Funds come from stablecoin collateral deposits

## Architecture

### 1. Smart Contract Updates

#### `Protocol.sol` - Added `isFeatured` Flag
```solidity
struct LoanListing {
    ...
    bool isFeatured; // NEW: Marks featured pools
}
```

#### `ProtocolFacet.sol` - Added Featured Management
```solidity
function setListingFeatured(uint96 _listingId, bool _featured) external onlyRole(ADMIN_ROLE)
```

#### `VaultFeaturedPool.sol` - New Contract
- Creates large loan listings from stablecoin collateral
- Automatically marks listings as featured
- Supports pool top-ups and withdrawals
- Manages pool balances

### 2. Frontend Updates

#### `Table.tsx` - Marketplace Display
- Featured listings sorted to top
- Green border and shadow for featured listings
- "FEATURED" badge next to asset name

## Implementation Flow

### Step 1: Deploy Featured Pool Contract
```javascript
const vault = await VaultFeaturedPool.deploy(
    kaleidoLendingProtocol,
    kfUSDContract
);
```

### Step 2: Create Featured Pool
```javascript
await vault.createFeaturedPool(
    USDC_ADDRESS,
    1_000_000 * 1e6,  // $1M USDC
    1200              // 12% APY
);
```

**What happens:**
1. Vault approves USDC to Kaleido lending
2. Creates loan listing with:
   - Amount: $1M USDC
   - Min: $100k (10% of pool)
   - Max: $1M (100% of pool)
   - Interest: 12%
   - Duration: 30 days
3. Marks listing as `isFeatured = true`
4. Listing appears on marketplace

### Step 3: Users Borrow from Pool
- Users see featured listing at top of marketplace
- Green border and "FEATURED" badge
- Click "Borrow" → Borrow any amount (min $100k)
- Same process as regular P2P borrowing

### Step 4: Pool Automatically Replenishes
When borrowers repay:
```javascript
await vault.topUpPool(USDC_ADDRESS, additionalAmount);
```

## Benefits

✅ **Instant Liquidity**: Large pools always available for borrowing
✅ **Pool-like UX**: Borrow without waiting for manual matching
✅ **Featured Display**: Clearly distinguished from user listings
✅ **Auto-Distribution**: Interest earned funds kafUSD yield
✅ **Dual Model**: Supports both P2P and pool-based approaches

## Yield Generation

```
User deposits USDC → Mint kfUSD
     ↓
50% idle (for redemptions)
50% deployed to featured pool
     ↓
Borrowers pay 12% interest
     ↓
Interest accumulates → Funds kafUSD yield
```

## Configuration

### Default Settings
```solidity
defaultInterestRate = 1200;  // 12% APY
defaultMaxDuration = 30 days;
minLoanPercent = 10%;        // Min 10% of pool per loan
```

### Admin Controls
- Set custom interest rates
- Adjust max duration
- Top up pools with more funds
- Close and recreate pools

## Comparison: P2P vs Featured Pool

| Feature | P2P Lending | Featured Pool |
|---------|------------|---------------|
| **Creating** | User deposits → Creates listing | Vault deposits → Creates large listing |
| **Matching** | Manual: borrower requests | Automatic: any amount (min-max) |
| **Interest** | User sets rate | Vault sets fixed rate |
| **Display** | Regular listing | Featured badge + top position |
| **Size** | Small (user capital) | Large (collateral pool) |
| **Replenish** | One-time use | Reusable pool |

## Future Enhancements

1. **Multiple Featured Pools**: Different tokens, interest rates
2. **Auto-Replenish**: Bot monitors and tops up automatically
3. **Dynamic Rates**: Adjust interest based on utilization
4. **Cross-Chain**: Bridge to other chains for more liquidity

## Files Changed

- `contracts/model/Protocol.sol` - Added `isFeatured` field
- `contracts/facets/ProtocolFacet.sol` - Added `setListingFeatured()` function
- `contracts/Stablecoin/VaultFeaturedPool.sol` - New featured pool manager
- `src/components/market/Table.tsx` - Featured listing display

## Integration with Existing System

This feature works alongside:
- ✅ Existing P2P lending (users can still create listings)
- ✅ Stablecoin mint/redeem (funds pool)
- ✅ kafUSD yield (interest from pool)
- ✅ Borrow/lend flows (same user experience)

**No breaking changes** - purely additive feature!

