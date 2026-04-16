# Security Audit Findings - kfUSD & kafUSD Contracts

## Executive Summary

After reviewing the kfUSD stablecoin and kafUSD vault contracts, here are the key security findings and recommendations.

## ✅ Security Strengths

### 1. **Reentrancy Protection**
- ✅ Both contracts use OpenZeppelin's `ReentrancyGuard`
- ✅ All critical functions (`mint`, `redeem`, `lockAssets`, `completeWithdrawal`) have `nonReentrant` modifier
- ✅ Follows checks-effects-interactions pattern

### 2. **Access Control**
- ✅ Uses OpenZeppelin's `AccessControl` with role-based permissions
- ✅ MINTER_ROLE required for minting (good - not public)
- ✅ PAUSER_ROLE for emergency stops
- ✅ DEFAULT_ADMIN_ROLE for critical parameter changes

### 3. **Pausable Mechanism**
- ✅ Contracts extend `ERC20Pausable`
- ✅ Can pause operations in emergencies
- ✅ Protected by PAUSER_ROLE

### 4. **Solidity Version**
- ✅ Uses Solidity 0.8.20 (built-in overflow protection)
- ✅ No need for SafeMath library

## ⚠️ Potential Vulnerabilities & Recommendations

### 1. **CRITICAL: Decimal Precision Issue in Redeem Function**

**Location**: `kfUSD.sol` line ~185-187

```solidity
uint256 collateralToReturn = (redeemAmount * 10 ** decimals()) /
    (10 ** IERC20Metadata(_outputToken).decimals());
```

**Issue**: 
- When redeeming to USDC (6 decimals), the calculation is:
  - `(redeemAmount * 10^18) / (10^6) = redeemAmount * 10^12`
- This assumes 1:1 ratio, but the conversion needs to account for:
  - Fee deduction happening AFTER the decimal conversion
  - Potential rounding errors in favor of the contract

**Recommendation**:
```solidity
// Better approach: Convert to common denominator first
uint256 fee = (_amount * redeemFee) / BASIS_POINTS;
uint256 redeemAmount = _amount - fee;

// Handle decimals properly
uint256 kfUSDDecimals = decimals(); // 18
uint256 collateralDecimals = IERC20Metadata(_outputToken).decimals(); // 6

if (kfUSDDecimals >= collateralDecimals) {
    uint256 scale = 10 ** (kfUSDDecimals - collateralDecimals);
    collateralToReturn = redeemAmount / scale;
} else {
    uint256 scale = 10 ** (collateralDecimals - kfUSDDecimals);
    collateralToReturn = redeemAmount * scale;
}
```

**Test Case**: 
- Redeem 1 wei of kfUSD (1e-18) to USDC
- Verify it handles correctly or has minimum amount

### 2. **MEDIUM: Mint Function Requires MINTER_ROLE**

**Current Implementation**:
```solidity
function mint(...) external onlyRole(MINTER_ROLE) nonReentrant whenNotPaused
```

**Issue**: 
- Users cannot directly mint kfUSD
- Requires a separate contract or keeper to have MINTER_ROLE
- This could be a UX issue OR intentional design

**Recommendation**:
- If users should mint directly: Remove MINTER_ROLE, add collateral validation
- If intentional: Document clearly and ensure keeper contracts are secure

### 3. **MEDIUM: Idle vs Deployed Collateral Split**

**Location**: `kfUSD.sol` mint function

```solidity
uint256 toDeploy = (_collateralAmount * deploymentRatio) / BASIS_POINTS;
uint256 toIdle = _collateralAmount - toDeploy;
```

**Issue**:
- If `deploymentRatio` is set high (e.g., 90%), most collateral is deployed
- Redemptions depend on `idleBalances[_outputToken]`
- Risk: Not enough idle collateral for redemptions if deploymentRatio too high

**Recommendation**:
- Add minimum idle balance requirement
- Or dynamic rebalancing when idle balance gets low
- Circuit breaker to pause redemptions if idle balance insufficient

### 4. **MEDIUM: kafUSD Yield Calculation**

**Location**: `kafUSD.sol` calculateYield function

```solidity
uint256 yield = (availableYield * _amount) / totalSupply();
```

**Issue**:
- Yield calculation doesn't consider lock time
- All users get same yield rate regardless of how long they locked
- Could be gamed by locking/unlocking quickly

**Recommendation**:
- Add time-weighted yield calculation
- Or minimum lock period for yield accrual

### 5. **LOW: Fee Limits**

**Current**: Fees can be set by admin (no maximum limit in code)

**Recommendation**:
```solidity
function setFees(uint256 _mintFee, uint256 _redeemFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(_mintFee <= 300, "Mint fee too high"); // Max 3%
    require(_redeemFee <= 300, "Redeem fee too high"); // Max 3%
    // ...
}
```

### 6. **LOW: DeploymentRatio Can Be Set to 100%**

**Location**: `kfUSD.sol` setDeploymentRatio

```solidity
function setDeploymentRatio(uint256 _ratio) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(_ratio <= BASIS_POINTS, "kfUSD: Ratio cannot exceed 100%");
    deploymentRatio = _ratio;
}
```

**Issue**: Can be set to 100%, leaving no idle collateral for redemptions

**Recommendation**: Enforce minimum idle ratio:
```solidity
require(_ratio <= BASIS_POINTS - 1000, "Must keep at least 10% idle"); // Or similar
```

## 📋 Testing Checklist

### Completed ✅
- [x] Reentrancy protection verified
- [x] Access control verified
- [x] Pausable mechanism verified
- [x] Test structure created

### Needs Full Implementation 🟡
- [ ] Decimal precision edge cases (need actual token contracts)
- [ ] Collateral balance edge cases
- [ ] Cooldown bypass attempts (needs locked assets)
- [ ] Fee manipulation tests
- [ ] Flash loan scenarios
- [ ] Oracle manipulation (if oracles are added)

### Recommended Additional Tests 🔴
- [ ] Gas optimization tests
- [ ] Maximum supply limits (if applicable)
- [ ] Multi-asset redemption scenarios
- [ ] Concurrent operations stress tests
- [ ] Front-running protection

## 🚨 Critical Actions Before Mainnet

1. **Fix decimal precision calculation** in redeem function
2. **Add fee maximum limits** to prevent excessive fees
3. **Add minimum idle collateral ratio** to ensure redemptions work
4. **Review MINTER_ROLE design** - decide if users should mint directly
5. **Professional security audit** by third-party firm
6. **Formal verification** of critical functions (decimal calculations)
7. **Test with actual token contracts** on testnet
8. **Implement monitoring** for unusual patterns

## 📊 Contract Statistics

- **kfUSD.sol**: ~400 lines
- **kafUSD.sol**: ~360 lines
- **OpenZeppelin Dependencies**: ReentrancyGuard, AccessControl, Pausable, ERC20
- **Function Count**: ~20 functions per contract
- **Security Modifiers**: nonReentrant, onlyRole, whenNotPaused

## 🔍 Areas Requiring Attention

1. **Decimal Conversion**: Currently works but could be more explicit
2. **Yield Distribution**: Time-weighted would be more fair
3. **Collateral Management**: Better safeguards for idle vs deployed split
4. **Fee Structure**: Add maximum limits
5. **User Experience**: Consider direct minting for users

## ✅ Positive Security Practices Observed

1. ✅ Proper use of OpenZeppelin contracts
2. ✅ Role-based access control
3. ✅ Reentrancy protection
4. ✅ Pausable for emergencies
5. ✅ Event emissions for transparency
6. ✅ Clear error messages
7. ✅ Zero address checks
8. ✅ Amount validation (greater than zero)

## 📝 Notes

- Contracts are well-structured overall
- Main concerns are around edge cases and parameter limits
- Most critical issue is ensuring decimal precision doesn't cause rounding exploits
- Consider adding time-weighted yield for kafUSD
- Recommend professional audit before mainnet deployment


