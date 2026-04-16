# Interest Rate Research for Featured Pools

## Research Summary

Based on analysis of major DeFi lending protocols and market conditions:

### Current Market Rates (2024)

**Aave / Compound (Pool-Based Lending):**
- USDC Supply APY: **3.5% - 5%** (typical range)
- USDT Supply APY: **4% - 6%**
- Dynamic rates based on utilization

**Yearn / Vaults:**
- Flexible Vaults: **8% - 10%**
- Locked Vaults (30 days): **12% - 15%**
- Risk-adjusted based on strategy

**Traditional P2P Lending:**
- Excellent credit: **5% - 8%**
- Moderate credit: **12% - 15%**
- Riskier loans: **20% - 35%**

### Kaleido Current Featured Pool Settings

**Current Configuration:**
```solidity
defaultInterestRate = 1200; // 12% APY (in basis points)
defaultMaxDuration = 30 days;
minLoanPercent = 10%; // Min 10% of pool
```

### Recommended Adjustments

#### Option 1: Competitive with Aave/Compound
```solidity
defaultInterestRate = 500; // 5% APY
defaultMaxDuration = 30 days;
```

**Reasoning:**
- Matches Aave/Compound supply rates
- Attractive to borrowers seeking competitive rates
- Lower risk, more sustainable

**Pros:**
- Very competitive with major DeFi protocols
- Lower default risk
- More attractive to borrowers

**Cons:**
- Lower yield for kfUSD holders (0.3% fee is fixed)
- Less margin for kafUSD yield

#### Option 2: Premium Vault-like (Recommended)
```solidity
defaultInterestRate = 800; // 8% APY
defaultMaxDuration = 30 days;
```

**Reasoning:**
- Slightly higher than Aave/Compound
- Premium justified by "featured" status and instant liquidity
- Similar to flexible vault yields

**Pros:**
- Better yield for kfUSD holders
- Still attractive to borrowers
- Balanced approach

**Cons:**
- Higher than major protocols (less competitive)
- Higher risk of defaults

#### Option 3: High-Yield Vault (Current)
```solidity
defaultInterestRate = 1200; // 12% APY
defaultMaxDuration = 30 days;
```

**Reasoning:**
- Similar to locked vault APYs
- High yield attracts borrowers
- Premium for instant liquidity

**Pros:**
- Maximum yield for kfUSD holders
- Very attractive to borrowers
- Strong incentive to use featured pools

**Cons:**
- Higher default risk
- May not be sustainable long-term
- Less competitive vs Aave (5%)

## Recommendation

**Use 8% APY (800 basis points)** for Featured Pools:

1. **Balance:** Not too low (like Aave at 5%), not too high (like locked vaults at 12%)
2. **Market Position:** Premium over Aave, competitive with other lending
3. **Sustainability:** Lower default risk than 12%
4. **User Benefit:** Higher yield for kfUSD holders vs 5%
5. **Borrower Appeal:** Attractive rate for borrowers seeking instant liquidity

### Implementation

**Update `VaultFeaturedPool.sol`:**
```solidity
uint16 public defaultInterestRate = 800; // 8% APY (was 1200 = 12%)
```

**Or make it configurable per token:**
```solidity
mapping(address => uint16) public tokenToInterestRate;

// Configure rates per token
function setTokenInterestRate(address _token, uint16 _rate) external onlyRole(ADMIN_ROLE) {
    tokenToInterestRate[_token] = _rate;
}
```

### Real-World Comparisons

| Platform | USDC APY | Lock Period | Risk |
|----------|---------|-------------|------|
| Aave | ~5% | None | Low |
| Compound | ~4% | None | Low |
| Yearn Flexible | ~8% | None | Medium |
| Yearn Locked (30d) | ~12% | 30 days | Medium |
| **Kaleido Featured** | **8%** | **None** | **Medium** |

## Conclusion

**8% APY** is the sweet spot:
- ✅ Competitive with major DeFi protocols
- ✅ Premium over Aave/Compound for better yields
- ✅ Sustainable and low default risk
- ✅ Attractive to borrowers
- ✅ Good yield for kfUSD holders

---

**Next Steps:**
1. Update `defaultInterestRate` to 800 (8% APY)
2. Test with real market data
3. Consider adding per-token interest rates
4. Monitor utilization and adjust if needed

