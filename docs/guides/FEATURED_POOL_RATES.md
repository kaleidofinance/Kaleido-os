# Featured Pool Interest Rates - Market Analysis

## Research Findings

After researching major DeFi lending protocols and current market rates:

### Market Rates (As of 2024)

| Platform | APY | Type | Risk Level |
|----------|-----|------|------------|
| **Aave** | ~5% | Pool-based lending | Low |
| **Compound** | ~4-5% | Pool-based lending | Low |
| **Yearn (Flexible)** | ~8-10% | Vault lending | Medium |
| **Yearn (30D Lock)** | ~12-15% | Locked vault | Medium |
| **Traditional P2P** | 8-15% | Individual loans | Medium-High |

### Our Featured Pool Settings

**Initial Plan:** 12% APY
- Too high compared to market
- Higher default risk
- Less sustainable long-term

**Updated:** **8% APY** (recommended)
- Competitive with major DeFi protocols
- Slightly higher than Aave (5%) for premium service
- Similar to flexible vault yields
- Lower default risk than 12%

## Why 8%?

### 1. Market Position
- **Aave offers 5%** → We offer **3% more** for featured pools
- **Yearn flexible offers 8%** → We match their rate
- **Premium justified** by instant liquidity and featured status

### 2. Sustainability
```
Example: $100k USDC Featured Pool at 8% APY

Potential income per year: $8,000
If all borrowed: $8,000 interest to kfUSD holders
If 50% borrowed: $4,000 interest

kfUSD holders benefit from:
- 0.3% mint fees
- 8% lending interest (from featured pools)
```

### 3. Borrower Appeal
- **8% is attractive** to borrowers
- **Lower risk** than high-rate predatory lending
- **Instant liquidity** vs waiting for P2P matching

### 4. Risk Management
- **Lower rates = lower defaults**
- **Sustainable long-term**
- **More conservative approach**

## Comparison with Current Kaleido Rates

Based on `YieldVaults.tsx`:
- **kfUSD APY:** 5% (current contract setting)
- **Vault APY:** 5%
- **Featured Pool APY:** 8% (new)

**Why featured pools offer more:**
1. Active lending (money is out being used)
2. Premium for instant liquidity
3. Funds deployed collateral

## Implementation

### Updated Settings
```solidity
// VaultFeaturedPool.sol
uint16 public defaultInterestRate = 800; // 8% APY
uint256 public defaultMaxDuration = 30 days;
uint256 public minLoanPercent = 10; // Min 10% of pool
```

### How It Works
```
User deposits 1000 USDC
     ↓
500 USDC → Featured Pool (8% APY)
     ↓
Pool available for borrowing
     ↓
Borrowers pay 8% interest
     ↓
Interest funds kfUSD yield
```

## Summary

✅ **8% APY is the ideal rate** for featured pools
- Competitive with major DeFi protocols
- Premium over Aave (5%) justified
- Sustainable and low risk
- Good yield for kfUSD holders
- Attractive to borrowers

**Changed from:** 12% → **8% APY**

