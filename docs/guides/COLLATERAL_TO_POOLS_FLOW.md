# How USDC, USDT, USDe Flow to Featured Lending Pools

## Complete Flow

### Step 1: User Deposits Collateral
```
User has USDC/USDT/USDe in wallet
     ↓
User connects wallet to /stable page
     ↓
User selects asset (USDC, USDT, or USDe)
     ↓
User enters amount to deposit
     ↓
Clicks "Mint kfUSD"
```

### Step 2: kfUSD Minting Process

**Location:** `src/hooks/useStablecoin.ts` - `mintKfUSD()` function

```typescript
// User deposits USDC to mint kfUSD
await kfUSDContract.mint(
    userAddress,        // Who gets kfUSD
    kfUSDAmount,        // Amount of kfUSD to mint (1:1 ratio)
    collateralAddress,  // USDC/USDT/USDe address
    collateralAmount    // Amount of collateral deposited
);
```

### Step 3: kfUSD Contract Handles Collateral

**Location:** `smart-contract/contracts/Stablecoin/kfUSD.sol` - `mint()` function

What happens inside the contract:
```solidity
// 1. Transfer collateral from user to kfUSD contract
IERC20(_collateralToken).transferFrom(msg.sender, address(this), _collateralAmount);

// 2. Split collateral: 50% idle, 50% for deployment
uint256 toIdle = (_collateralAmount * (10000 - deploymentRatio)) / 10000;
uint256 toDeploy = (_collateralAmount * deploymentRatio) / 10000;

// 3. Store idle collateral for redemptions
idleBalances[_collateralToken] += toIdle;
deployedBalances[_collateralToken] += toDeploy;

// 4. AUTO-DEPLOY to vault (if enabled) ⭐
if (autoDeploymentEnabled && vaultAddress != address(0) && toDeploy > 0) {
    IERC20(_collateralToken).approve(vaultAddress, toDeploy);
    IERC20(_collateralToken).transfer(vaultAddress, toDeploy); // ← SENT TO VAULT
}

// 5. Track fees
feeTreasury += fee;

// 6. Mint kfUSD to user
_mint(_to, mintAmount);
```

### Step 4: Vault Receives Collateral

**Location:** `smart-contract/contracts/Stablecoin/KfUSDVaultKaleidoLending.sol`

When `kfUSD` transfers tokens to the vault:
```solidity
function onReceive(address _token) external {
    require(msg.sender == address(kfusdContract), "Only kfUSD can send");
    
    uint256 received = IERC20(_token).balanceOf(address(this));
    // received = USDC/USDT/USDe that was deployed from kfUSD
    
    collateralReceived[_token] += received;
    
    // Check if featured pool exists for this token
    uint96 existingListing = tokenToFeaturedListing[_token];
    
    if (existingListing == 0) {
        // Create NEW featured pool
        createFeaturedPool(_token, received, defaultInterestRate);
    } else {
        // Top up EXISTING pool
        poolBalances[_token] += received;
    }
}
```

### Step 5: Featured Pool Created on Kaleido Lending

**Location:** `smart-contract/contracts/Stablecoin/VaultFeaturedPool.sol`

```solidity
function createFeaturedPool(address _token, uint256 _amount, uint16 _interestRate) {
    // 1. Approve Kaleido lending protocol
    IERC20(_token).approve(kaleidoLendingProtocol, _amount);
    
    // 2. Create loan listing
    IProtocol(kaleidoLendingProtocol).createLoanListing(
        _amount,                  // Total pool: $100k USDC
        _amount / 10,             // Min: $10k per loan
        _amount,                  // Max: $100k per loan
        block.timestamp + 30 days, // 30 days max
        _interestRate,            // 12% APY
        _token                     // USDC
    );
    
    // 3. Get listing ID
    uint96 listingId = getLatestListingId();
    tokenToFeaturedListing[_token] = listingId;
    
    // 4. Mark as FEATURED ⭐
    IProtocol(kaleidoLendingProtocol).setListingFeatured(listingId, true);
}
```

### Step 6: Featured Pool Appears on Marketplace

**Location:** `src/components/market/Table.tsx`

The listing now appears:
- ✅ At the TOP of the marketplace
- ✅ With green border and shadow
- ✅ With "FEATURED" badge
- ✅ Clear distinction from user listings

Frontend sorting logic:
```typescript
const sorted = filtered.sort((a, b) => {
    // Featured listings always on top
    if (a.isFeatured && !b.isFeatured) return -1;
    if (!a.isFeatured && b.isFeatured) return 1;
    // Then by listing ID
    return Number(b.listingId) - Number(a.listingId);
});
```

## Visual Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    USER DEPOSITS COLLATERAL                  │
│  User deposits 1000 USDC to mint kfUSD                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                     kfUSD MINT FUNCTION                       │
│  • Transfers 1000 USDC from user → kfUSD contract            │
│  • Splits: 500 USDC idle, 500 USDC deploy                   │
│  • 500 USDC sent to vault                                    │
│  • Mints 1000 kfUSD to user (minus 0.3% fee)                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  VAULT RECEIVES 500 USDC                      │
│  KfUSDVaultKaleidoLending.onReceive(USDC_ADDRESS)            │
│  • Checks if featured pool exists for USDC                  │
│  • If NOT: Creates new featured pool                       │
│  • If EXISTS: Tops up existing pool                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                FEATURED POOL CREATED ON KALEIDO               │
│  • Creates loan listing: 500 USDC at 12% APY               │
│  • Min: 50 USDC, Max: 500 USDC                              │
│  • Marks listing.isFeatured = true                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              APPEARS ON MARKETPLACE PAGE                       │
│  • Featured listings at TOP                                 │
│  • Green border + shadow + "FEATURED" badge                 │
│  • Anyone can borrow 50-500 USDC at 12%                     │
└─────────────────────────────────────────────────────────────┘
```

## Example Scenario

### Initial State
- No featured pools exist

### User 1 deposits 1000 USDC
1. Mints 1000 kfUSD (minus 0.3% fee = 997 kfUSD)
2. 500 USDC deployed to vault
3. Vault creates featured pool: **USDC Pool 1** (500 USDC at 12%)
4. Featured pool appears on marketplace

### User 2 deposits 500 USDT
1. Mints 500 kfUSD
2. 250 USDT deployed to vault  
3. Vault creates featured pool: **USDT Pool 1** (250 USDT at 12%)
4. Another featured pool appears

### User 3 deposits 2000 USDC
1. Mints 2000 kfUSD
2. 1000 USDC deployed to vault
3. Vault tops up **USDC Pool 1** (+1000 USDC = 1500 total)
4. Pool now has 1500 USDC available

### Borrower Action
1. Borrows 100 USDC from **USDC Pool 1**
2. Pays back 112 USDC (100 + 12% interest) after 1 year
3. Interest funds kafUSD yield

## Configuration

### Current Settings (kfUSD.sol)
```solidity
deploymentRatio = 5000;  // 50% deployed to pools
mintFee = 30;            // 0.3% mint fee
redeemFee = 30;          // 0.3% redeem fee
```

### Featured Pool Settings
```solidity
defaultInterestRate = 1200;  // 12% APY
defaultMaxDuration = 30 days; // Max loan duration
```

### Example: Minting with 10,000 USDC

**Total USDC: 10,000**
```
├─ Idle: 5,000 USDC (50%) ← Available for immediate redemption
└─ Deployed: 5,000 USDC (50%) ← Goes to featured pool
```

**Deployed 5,000 USDC Flow:**
1. Sent to `KfUSDVaultKaleidoLending`
2. Creates/updates USDC featured pool
3. Pool available for borrowing on marketplace
4. Interest earned → Funds kafUSD yield

**Result:**
- Featured pool: 5,000 USDC at 12% APY
- Min borrow: 500 USDC
- Max borrow: 5,000 USDC
- Interest: 600 USDC per year (if fully borrowed)

## Multi-Token Support

### Supported Collaterals: USDC, USDT, USDe

Each token gets its own featured pool:
- **USDC Pool** ← From USDC deposits
- **USDT Pool** ← From USDT deposits  
- **USDe Pool** ← From USDe deposits

### Automatic Pool Creation
```solidity
// First USDC deposit creates USDC Pool
collateralReceived[USDC] = 1000 USDC
tokenToFeaturedListing[USDC] = Listing #5

// First USDT deposit creates USDT Pool
collateralReceived[USDT] = 500 USDT
tokenToFeaturedListing[USDT] = Listing #6

// USDC deposit tops up existing pool
collateralReceived[USDC] = 2000 USDC (+1000)
// Pool balance: 1000 + 1000 = 2000 USDC
```

## Integration Points

### Frontend: Mint kfUSD
- `src/components/stable/MintRedeem.tsx`
- Calls `useStablecoin` hook
- Calls `mintKfUSD()` function

### Smart Contract: kfUSD
- `contracts/Stablecoin/kfUSD.sol`
- Split collateral (50/50)
- Auto-deploy to vault
- Track `idleBalances` vs `deployedBalances`

### Vault: KfUSDVaultKaleidoLending  
- `contracts/Stablecoin/KfUSDVaultKaleidoLending.sol`
- Receives deployed collateral
- Creates/tops up featured pools
- Auto-creates pools for each token type

### Marketplace: Featured Display
- `src/components/market/Table.tsx`
- Featured listings at top
- Green border, badge, shadow
- Clear visual distinction

## Summary

✅ **USDC/USDT/USDe → Featured Pools = AUTOMATIC**

1. User deposits USDC → Mints kfUSD
2. 50% deployed → Goes to vault
3. Vault creates featured pool on Kaleido lending
4. Pool appears at top of marketplace
5. Borrowers use pool → Interest funds kafUSD yield

**The entire process is automated! No manual intervention needed.**

