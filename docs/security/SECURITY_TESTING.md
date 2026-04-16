# Security Testing Guide for Stablecoin Contracts

## Overview

This directory contains comprehensive security testing for the kfUSD stablecoin and kafUSD vault contracts. The tests cover 18+ attack vectors commonly used against stablecoins and DeFi vaults.

## Quick Start

### 1. Install Dependencies
```bash
cd smart-contract
npm install
```

### 2. Run Security Audit Script
```bash
npx hardhat run scripts/security-audit.js
```

### 3. Run Security Test Suite
```bash
npx hardhat test test/StablecoinSecurity.test.js
```

### 4. Run All Tests
```bash
npx hardhat test
```

## Test Coverage

### Critical Tests (Must Pass)
- ✅ Reentrancy protection
- ✅ Access control
- ✅ Collateral insufficiency checks
- ✅ Infinite minting prevention

### High Priority Tests
- ✅ Flash loan attack resistance
- ✅ Price oracle manipulation protection
- ✅ Decimal precision handling
- ✅ Vault lock/unlock logic

### Medium Priority Tests
- ✅ Front-running/MEV protection
- ✅ Fee manipulation prevention
- ✅ Cooldown bypass prevention
- ✅ Gas optimization

## Attack Vectors Tested

### 1. Reentrancy Attacks
**Test**: `Reentrancy Attacks` suite
**What it checks**: 
- ReentrancyGuard implementation
- Checks-effects-interactions pattern
- No recursive calls possible

**How to test manually**:
```javascript
// Deploy malicious contract that attempts reentry
const attacker = await deployContract("ReentrancyAttacker", [kfUSD.address]);
await expect(attacker.attack()).to.be.revertedWith("ReentrancyGuard");
```

### 2. Flash Loan Attacks
**Test**: `Flash Loan Attacks` suite
**What it checks**:
- Minimum time delays between operations
- Maximum transaction limits
- Price staleness checks

**Manual test**:
- Borrow large amount via flash loan
- Manipulate price/oracle
- Attempt to mint/redeem
- Should be blocked by circuit breakers

### 3. Price Oracle Manipulation
**Test**: `Price Oracle Manipulation` suite
**What it checks**:
- Multiple oracle sources
- Staleness checks
- Maximum deviation limits

**Manual test**:
- Try to use stale price data
- Attempt extreme price deviation
- Verify circuit breakers activate

### 4. Integer Overflow/Underflow
**Test**: `Integer Overflow/Underflow` suite
**What it checks**:
- Solidity 0.8+ compiler (automatic checks)
- SafeMath if older version
- Maximum amount handling

### 5. Decimal Precision Errors
**Test**: `Decimal Precision Errors` suite
**What it checks**:
- USDC (6 decimals) → kfUSD (18 decimals) scaling
- 1:1 ratio maintenance
- Rounding errors

**Example test**:
```javascript
// 1000 USDC (6 decimals) should mint 1000 kfUSD (18 decimals)
const deposit = ethers.parseUnits("1000", 6);
const expected = ethers.parseEther("1000");
await kfUSD.mint(user, expected, USDC.address, deposit);
expect(await kfUSD.balanceOf(user)).to.equal(expected);
```

### 6. Access Control Issues
**Test**: `Access Control Issues` suite
**What it checks**:
- Only authorized addresses can mint
- Admin functions protected
- Multi-sig requirements (if applicable)

### 7. Collateral Insufficiency
**Test**: `Collateral Insufficiency` suite
**What it checks**:
- Cannot mint without collateral
- Cannot redeem more than available
- Reserve ratio validation

### 8. Front-Running / MEV
**Test**: `Front-Running / MEV Attacks` suite
**What it checks**:
- Slippage protection
- Minimum output amounts
- Transaction deadlines

### 9. Rounding Errors / Dust
**Test**: `Rounding Errors / Dust Attacks` suite
**What it checks**:
- Minimum transaction amounts
- Dust accumulation prevention
- Fee calculations don't drain small amounts

### 10. Cooldown Bypass (kafUSD)
**Test**: `Cooldown Bypass` suite
**What it checks**:
- Cannot withdraw before cooldown
- Time manipulation resistance
- Multiple withdrawal requests

### 11. Infinite Minting
**Test**: `Infinite Minting / Supply Inflation` suite
**What it checks**:
- Requires collateral for minting
- Maximum supply limits (if exists)
- Supply tracking accuracy

### 12. Fee Manipulation
**Test**: `Fee Manipulation` suite
**What it checks**:
- Maximum fee limits
- Fee calculation accuracy
- Fee recipient access control

### 13. Vault Lock/Unlock Logic
**Test**: `Vault Lock/Unlock Logic` suite
**What it checks**:
- Cannot lock zero amounts
- Cannot unlock more than locked
- Proper accounting

### 14. Pause Mechanism
**Test**: `Pause Mechanism` suite
**What it checks**:
- Operations blocked when paused
- Only authorized can pause
- Cannot bypass pause

### 15-18. Additional Tests
- ERC20 integration issues (non-standard tokens)
- Backing ratio manipulation
- Gas optimization & DoS
- Edge cases

## Running Specific Test Suites

### Run only reentrancy tests:
```bash
npx hardhat test --grep "Reentrancy"
```

### Run only access control tests:
```bash
npx hardhat test --grep "Access Control"
```

### Run only decimal precision tests:
```bash
npx hardhat test --grep "Decimal Precision"
```

## Automated Security Tools

### Recommended Tools:

1. **Slither** (Static Analysis)
```bash
pip install slither-analyzer
slither contracts/Stablecoin/
```

2. **Mythril** (Symbolic Execution)
```bash
pip install mythril
myth analyze contracts/Stablecoin/kfUSD.sol
```

3. **Echidna** (Fuzzing)
```bash
# Install Echidna
# Write property-based tests
echidna-test contracts/Stablecoin/
```

4. **Foundry** (Advanced Testing)
```bash
forge install
forge test
```

## Manual Testing Checklist

Before deploying to mainnet, manually verify:

- [ ] All test suites pass
- [ ] Reentrancy guards in place
- [ ] Access controls verified
- [ ] Oracle integration tested
- [ ] Decimal precision verified
- [ ] Maximum limits tested
- [ ] Pause mechanism works
- [ ] Upgrade path tested (if upgradeable)
- [ ] Gas optimization reviewed
- [ ] Edge cases handled

## Security Best Practices

1. **Always use**:
   - OpenZeppelin Contracts
   - ReentrancyGuard
   - SafeERC20 for token operations
   - Multi-sig for admin functions

2. **Implement**:
   - Circuit breakers
   - Rate limiting
   - Maximum transaction limits
   - Event logging

3. **Test**:
   - Edge cases
   - Extreme values
   - Malicious actors
   - Integration scenarios

4. **Audit**:
   - Professional security audit before mainnet
   - Bug bounty program
   - Formal verification for critical functions

## Reporting Issues

If you find vulnerabilities:
1. DO NOT open public GitHub issues
2. Email security team directly
3. Include detailed reproduction steps
4. Allow time for fix before disclosure

## Resources

- [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) - Detailed audit checklist
- [Common Attack Vectors](https://consensys.github.io/smart-contract-best-practices/)
- [OpenZeppelin Security](https://docs.openzeppelin.com/contracts/security)


